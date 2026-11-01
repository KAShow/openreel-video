import {
  RegisteredTool,
  actionTool,
  num,
  obj,
  str,
} from "./shared";

export const subtitleTools: RegisteredTool[] = [
  actionTool({ name: "add_subtitle", domain: "subtitle", actionType: "subtitle/add", title: "Add subtitle", description: "Add a subtitle (text, start, end seconds).", inputSchema: obj({ text: str, startTime: num, endTime: num }, ["text", "startTime", "endTime"]) }),
  actionTool({ name: "remove_subtitle", domain: "subtitle", actionType: "subtitle/remove", title: "Remove subtitle", description: "Remove a subtitle.", inputSchema: obj({ subtitleId: str }, ["subtitleId"]), destructive: true }),
  actionTool({ name: "update_subtitle", domain: "subtitle", actionType: "subtitle/update", title: "Update subtitle", description: "Update a subtitle's text and/or timing (text, startTime, endTime seconds).", inputSchema: obj({ subtitleId: str, text: str, startTime: num, endTime: num }, ["subtitleId"]) }),
  actionTool({ name: "import_srt", domain: "subtitle", actionType: "subtitle/import", title: "Import SRT", description: "Import subtitles from SRT content.", inputSchema: obj({ srtContent: str }, ["srtContent"]) }),
  actionTool({ name: "set_subtitle_style", domain: "subtitle", actionType: "subtitle/setStyle", title: "Subtitle style", description: "Set the global subtitle style.", inputSchema: obj({ style: { type: "object" } }, ["style"]) })
];
