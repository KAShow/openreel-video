import {
  RegisteredTool,
  jobTool,
  obj,
  str,
} from "./shared";

export const exportTools: RegisteredTool[] = [
  jobTool(
    "export_video",
    "export",
    "Export video",
    "Render the whole project to a local video file (format: mp4|webm|mov, default mp4) and return its local result metadata. Expensive — requires confirmation.",
    "exportVideo",
    obj({ format: str }),
  ),
  jobTool(
    "export_audio",
    "export",
    "Export audio",
    "Render the project audio to a local file (format: mp3|wav|aac|flac|ogg, default wav) and return its local result metadata. Expensive — requires confirmation.",
    "exportAudio",
    obj({ format: str }),
  )
];
