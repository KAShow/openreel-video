import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './marketplace/types';
import { getIdentity, requireApiToken, tokenMatches } from './marketplace/auth';
import marketplace from './marketplace/marketplace';
import studio from './marketplace/studio';
import events from './marketplace/events';
import crash from './crash/routes';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors({
  origin: (origin) => {
    if (!origin) return origin;
    const ok =
      /^http:\/\/localhost:\d+$/.test(origin) ||
      /\.openreel-studio\.pages\.dev$/.test(origin) ||
      origin === 'https://openreel-studio.pages.dev' ||
      /\.openreel\.video$/.test(origin) ||
      origin === 'https://app.openreel.video' ||
      origin === 'https://studio.openreel.video';
    return ok ? origin : undefined;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Bundle-ID', 'X-User-Id', 'X-Creator-Id', 'X-Creator-Handle'],
  maxAge: 86400,
}));

// Marketplace + Studio API (STUDIO_PLAN §34), mounted under /v1.
app.route('/v1', marketplace);
app.route('/v1', studio);
app.route('/v1', events);

// Desktop/app crash + error collection (POST /crash; guarded GET /crash).
app.route('/', crash);

app.get('/', (c) => {
  return c.json({
    name: 'OpenReel Cloud API',
    version: '1.0.0',
    endpoints: {
      marketplace: {
        assets: 'GET /v1/assets',
        asset: 'GET /v1/assets/:id',
        install: 'POST /v1/assets/:id/install',
        search: 'GET /v1/search?q=',
        blueprints: 'GET /v1/blueprints',
        nodelib: 'GET /v1/nodelib?abi=1.2',
      },
      studio: {
        drafts: 'POST /v1/drafts · PUT /v1/drafts/:id',
        validate: 'POST /v1/drafts/:id/validate',
        submit: 'POST /v1/drafts/:id/submit',
        review: 'POST /v1/submissions/:id/review',
      },
      events: 'POST /v1/events',
      crash: 'POST /crash',
      templates: {
        list: 'GET /templates',
        get: 'GET /templates/:id',
        upload: 'POST /templates',
        delete: 'DELETE /templates/:id',
      },
    },
  });
});

app.get('/templates', async (c) => {
  const bucket = c.env.TEMPLATES_BUCKET;
  const { cursor } = c.req.query();

  try {
    const listed = await bucket.list({
      limit: 100,
      cursor: cursor || undefined,
    });

    const templates = await Promise.all(
      listed.objects.map(async (obj) => {
        const template = await bucket.get(obj.key);
        if (!template) return null;
        const data = await template.json() as Record<string, unknown>;
        return {
          id: obj.key.replace('.json', ''),
          name: data.name,
          category: data.category,
          description: data.description,
          thumbnailUrl: data.thumbnailUrl,
          placeholderCount: (data.placeholders as unknown[] | undefined)?.length || 0,
          duration: (data.timeline as Record<string, unknown> | undefined)?.duration || 0,
          createdAt: data.createdAt,
          tags: data.tags,
          author: data.author,
        };
      })
    );

    return c.json({
      templates: templates.filter(Boolean),
      cursor: listed.truncated ? (listed as { cursor?: string }).cursor : undefined,
      truncated: listed.truncated,
    });
  } catch (error) {
    return c.json({ error: 'Failed to list templates' }, 500);
  }
});

app.get('/templates/:id', async (c) => {
  const id = c.req.param('id');
  const bucket = c.env.TEMPLATES_BUCKET;

  try {
    const template = await bucket.get(`${id}.json`);

    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }

    const data = await template.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: 'Failed to get template' }, 500);
  }
});

// Template ids become R2 object keys: restrict to URL-safe slugs.
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

app.post('/templates', async (c) => {
  const denied = requireApiToken(c, 'STUDIO_API_TOKEN');
  if (denied) return denied;

  const bucket = c.env.TEMPLATES_BUCKET;

  try {
    const body = await c.req.json();

    if (
      !body.id || !body.name || !body.timeline ||
      typeof body.id !== 'string' || typeof body.name !== 'string' ||
      typeof body.timeline !== 'object' ||
      !TEMPLATE_ID_PATTERN.test(body.id)
    ) {
      return c.json({ error: 'Invalid template format. Required: id (lowercase slug), name, timeline' }, 400);
    }

    const templateId = body.id;
    const key = `${templateId}.json`;

    const existing = await bucket.get(key);
    if (existing) {
      return c.json({ error: 'Template with this ID already exists' }, 409);
    }

    const template = {
      ...body,
      createdAt: body.createdAt || Date.now(),
      modifiedAt: Date.now(),
      version: body.version || '1.0.0',
    };

    const identity = getIdentity(c);

    await bucket.put(key, JSON.stringify(template, null, 2), {
      httpMetadata: {
        contentType: 'application/json',
      },
      customMetadata: {
        name: template.name,
        category: template.category || 'custom',
        author: template.author || 'anonymous',
        uploadedBy: identity?.userId || 'unknown',
      },
    });

    return c.json({
      success: true,
      id: templateId,
      message: 'Template uploaded successfully',
    }, 201);
  } catch (error) {
    console.error('Upload error:', error);
    return c.json({ error: 'Failed to upload template' }, 500);
  }
});

app.delete('/templates/:id', async (c) => {
  const isAdmin = tokenMatches(c, c.env.REVIEW_ADMIN_TOKEN);
  if (!isAdmin) {
    const denied = requireApiToken(c, 'STUDIO_API_TOKEN');
    if (denied) return denied;
  }

  const id = c.req.param('id');
  const bucket = c.env.TEMPLATES_BUCKET;

  if (id.startsWith('builtin-')) {
    return c.json({ error: 'Cannot delete built-in templates' }, 403);
  }

  try {
    const key = `${id}.json`;
    const object = await bucket.head(key);
    if (!object) {
      return c.json({ error: 'Template not found' }, 404);
    }

    // Ownership: only the uploader (or a review admin) may delete. Templates
    // uploaded before this metadata existed stay deletable by any studio user.
    const uploadedBy = object.customMetadata?.uploadedBy;
    const identity = getIdentity(c);
    if (!isAdmin && uploadedBy && identity?.userId !== uploadedBy) {
      return c.json({ error: 'Only the uploader or a review admin can delete this template' }, 403);
    }

    await bucket.delete(key);

    return c.json({
      success: true,
      message: 'Template deleted successfully',
    });
  } catch (error) {
    return c.json({ error: 'Failed to delete template' }, 500);
  }
});

app.post('/shares', async (c) => {
  const bucket = c.env.SHARES_BUCKET;

  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const shareId = crypto.randomUUID();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    await bucket.put(`shares/${shareId}`, file.stream(), {
      httpMetadata: {
        contentType: file.type || 'video/webm',
      },
      customMetadata: {
        filename: file.name,
        expiresAt: expiresAt.toString(),
        size: file.size.toString(),
      },
    });

    return c.json({
      shareId,
      shareUrl: `https://app.openreel.video/#/share/${shareId}`,
      expiresAt,
    }, 201);
  } catch (error) {
    console.error('Share upload error:', error);
    return c.json({ error: 'Failed to upload file for sharing' }, 500);
  }
});

app.get('/shares/:id', async (c) => {
  const bucket = c.env.SHARES_BUCKET;
  const shareId = c.req.param('id');

  try {
    const object = await bucket.head(`shares/${shareId}`);

    if (!object) {
      return c.json({ error: 'Share not found' }, 404);
    }

    const expiresAt = parseInt(object.customMetadata?.expiresAt || '0');

    if (Date.now() > expiresAt) {
      await bucket.delete(`shares/${shareId}`);
      return c.json({ error: 'Share link has expired' }, 410);
    }

    return c.json({
      shareId,
      filename: object.customMetadata?.filename || 'video.webm',
      size: parseInt(object.customMetadata?.size || '0'),
      expiresAt,
      expiresIn: Math.floor((expiresAt - Date.now()) / 1000 / 60),
    });
  } catch (error) {
    console.error('Get share error:', error);
    return c.json({ error: 'Failed to get share info' }, 500);
  }
});

app.get('/shares/:id/download', async (c) => {
  const bucket = c.env.SHARES_BUCKET;
  const shareId = c.req.param('id');

  try {
    const object = await bucket.get(`shares/${shareId}`);

    if (!object) {
      return c.json({ error: 'Share not found' }, 404);
    }

    const expiresAt = parseInt(object.customMetadata?.expiresAt || '0');

    if (Date.now() > expiresAt) {
      return c.json({ error: 'Share link has expired' }, 410);
    }

    const filename = object.customMetadata?.filename || 'video.webm';

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'video/webm',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': object.size.toString(),
      },
    });
  } catch (error) {
    console.error('Download share error:', error);
    return c.json({ error: 'Failed to download share' }, 500);
  }
});


app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: Date.now() });
});

export default app;
