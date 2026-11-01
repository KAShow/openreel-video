import {
  RegisteredTool,
  actionTool,
  fail,
  num,
  obj,
  ok,
  str,
} from "./shared";

export const projectTools: RegisteredTool[] = [
  {
    name: "create_project",
    domain: "project",
    title: "Create project",
    description: "Create a new blank project and make it active. Call this first when starting from scratch. Defaults to 1920x1080 at 30fps.",
    inputSchema: obj({ name: str, width: num, height: num, frameRate: num }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      if (typeof host.createProject !== "function") {
        return fail("create_project is not available in this host", "UNSUPPORTED");
      }
      const ref = await host.createProject({
        name: typeof args.name === "string" ? args.name : undefined,
        width: typeof args.width === "number" ? args.width : undefined,
        height: typeof args.height === "number" ? args.height : undefined,
        frameRate: typeof args.frameRate === "number" ? args.frameRate : undefined,
      });
      return ok(`Created project "${ref.name}" (${ref.width}x${ref.height} @ ${ref.frameRate}fps)`, ref);
    },
  },
  {
    name: "list_projects",
    domain: "project",
    title: "List projects",
    description: "List saved projects (id + name + modifiedAt). Use an id with open_project.",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (_args, host) => {
      if (typeof host.listProjects !== "function") {
        return fail("list_projects is not available in this host", "UNSUPPORTED");
      }
      const projects = await host.listProjects();
      return ok(`${projects.length} saved project(s)`, { projects });
    },
  },
  {
    name: "open_project",
    domain: "project",
    title: "Open project",
    description: "Open a saved project by id and make it active.",
    inputSchema: obj({ id: str }, ["id"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      if (typeof host.openProject !== "function") {
        return fail("open_project is not available in this host", "UNSUPPORTED");
      }
      const ref = await host.openProject(String(args.id));
      return ok(`Opened project "${ref.name}"`, ref);
    },
  },
  {
    name: "save_project",
    domain: "project",
    title: "Save project",
    description: "Persist the active project so it can be reopened later.",
    inputSchema: obj({}),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (_args, host) => {
      if (typeof host.saveProject !== "function") {
        return fail("save_project is not available in this host", "UNSUPPORTED");
      }
      const ref = await host.saveProject();
      return ok(`Saved project "${ref.name}"`, ref);
    },
  },
  actionTool({ name: "update_project_settings", domain: "project", actionType: "project/updateSettings", title: "Update settings", description: "Update resolution/fps/etc.", inputSchema: obj({ width: num, height: num, frameRate: num }) }),
  actionTool({ name: "rename_project", domain: "project", actionType: "project/rename", title: "Rename project", description: "Rename the project.", inputSchema: obj({ name: str }, ["name"]) }),
  actionTool({ name: "set_canvas_background", domain: "project", actionType: "project/setCanvasBackground", title: "Canvas background", description: "Set background fill mode/color.", inputSchema: obj({ backgroundFillMode: str, layoutBackgroundColor: str }) })
];
