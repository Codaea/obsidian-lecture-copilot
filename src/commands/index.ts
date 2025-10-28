import { Plugin } from "obsidian";
import { registerUpdateTranscriptCommand } from "./updateTranscriptFormat";

export function registerCommands(plugin: Plugin) {
    registerUpdateTranscriptCommand(plugin);
    
}
