import { MarkdownView, WorkspaceLeaf } from 'obsidian';
// Utility functions for the Lecture Copilot plugin
export async function getLeafFilename(leaf: WorkspaceLeaf): Promise<string | undefined> {
    const file = leaf?.view instanceof MarkdownView
        ? (leaf.view as MarkdownView).file
        : null;

    return file?.basename; // This is the filename without extension 
}