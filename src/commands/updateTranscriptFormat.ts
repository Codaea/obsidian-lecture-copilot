import { App, Plugin } from "obsidian";
import { dump } from "js-yaml";

export async function updateTranscriptFormat(app: App, filePath: string): Promise<void> {
    const adapter = app.vault.adapter;
    if (!await adapter.exists(filePath)) {
        throw new Error("File does not exist: " + filePath);
    }
    const content = await adapter.read(filePath);
    // Simple detection: look for old format markers
    const hasFrontmatter = content.startsWith("---");
    const hasParaphrased = content.includes("# Paraphrased Summary");
    const hasRewrites = content.includes("## Rewrites");
    const hasOriginal = content.includes("## Original Transcript");
    if (hasFrontmatter && hasParaphrased && hasRewrites && hasOriginal) {
        // Already in new format
        return;
    }
    // Extract old frontmatter if present
    let frontmatter = {};
    let body = content;
    if (hasFrontmatter) {
        const fmMatch = content.match(/^---\n([\s\S]*?)---\n/);
        if (fmMatch) {
            try {
                frontmatter = (window as any).jsyaml.load(fmMatch[1]);
            } catch {}
            body = content.slice(fmMatch[0].length);
        }
    }
    // Try to extract paraphrased and rewrite sections
    let paraphrased = "";
    let rewrite = "";
    let transcript = body;
    const paraMatch = body.match(/# Paraphrased Summary\n([\s\S]*?)(?=##|$)/);
    if (paraMatch) {
        paraphrased = paraMatch[1].trim();
        transcript = transcript.replace(paraMatch[0], "");
    }
    const rewriteMatch = body.match(/## Rewrites\n([\s\S]*?)(?=##|$)/);
    if (rewriteMatch) {
        rewrite = rewriteMatch[1].trim();
        transcript = transcript.replace(rewriteMatch[0], "");
    }
    // Remove any old 'Original Transcript' heading
    transcript = transcript.replace(/## Original Transcript\n/, "");
    // Build new frontmatter
    const now = new Date();
    const newFrontmatter = {
        ...frontmatter,
        models: {
            paraphraser: { date: now.toISOString().slice(0, 10) },
            rewriter: { date: now.toISOString().slice(0, 10) }
        }
    };
    const yaml = dump(newFrontmatter, { lineWidth: -1 });
    const newContent = `---\n${yaml}---\n\n# Paraphrased Summary\n\n${paraphrased ? `> ${paraphrased}\n\n` : ''}## Rewrites\n\n${rewrite ? `> ${rewrite}\n\n` : ''}## Original Transcript\n\n${transcript.trim()}`;
    await adapter.write(filePath, newContent);
}

export function registerUpdateTranscriptCommand(plugin: Plugin) {
    plugin.addCommand({
        id: "update-transcript-format",
        name: "Update Transcript Format",
        callback: async () => {
            const app = plugin.app;
            const files = app.vault.getFiles().filter(f => f.path.startsWith("transcripts/") && f.extension === "md");
            for (const file of files) {
                try {
                    await updateTranscriptFormat(app, file.path);
                } catch (e) {
                    console.error("Failed to update transcript:", file.path, e);
                }
            }
            new (window as any).Notice("Transcript format update complete.");
        }
    });
}
