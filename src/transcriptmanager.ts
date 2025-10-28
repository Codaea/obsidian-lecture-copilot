import { App, normalizePath, Notice, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import { getLeafFilename } from "./util";
import { dump, load } from "js-yaml";
import { AIClient } from "./aiclient";

interface TranscriptContent {
    speaker: {
        name: string;
        role: string;

    }, 
    SourceTranscript: string;
    RewrittenTranscript?: string;
    ParaphrasedTranscript?: string;
}

export class TranscriptManager {
    private aiclient?: AIClient;
    constructor(private app: App, aiclient?: AIClient) {
        this.aiclient = aiclient;
    }

    async saveTranscript(transcript: string) {
        const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
        if (!mostRecentLeaf) {
            new Notice("No active leaf found to save the transcript.");
            throw new Error("No active leaf found.");
        }

        const transcriptsFolder = 'transcripts';
        // make sure folder exists
        const transcriptsFolderPath = normalizePath(transcriptsFolder);
        if (!await this.app.vault.adapter.exists(transcriptsFolderPath)) {
            await this.app.vault.createFolder(transcriptsFolderPath);
        }

    // get a safe filename for the leaf. getLeafFilename returns a Promise<string|undefined>
    const leafName = await getLeafFilename(mostRecentLeaf);
    const baseName = leafName ? `transcript-${leafName}` : `transcript-${Date.now()}`;
    // sanitize filename to avoid invalid characters
    const safeLeafName = baseName.replace(/[^a-zA-Z0-9-_.]/g, '-');
    const filePath = normalizePath(`${transcriptsFolder}/${safeLeafName}.md`);

        // build content object and delegate writing to writeTranscriptContent
        const transcriptContent: TranscriptContent = {
            speaker: { name: '', role: '' },
            SourceTranscript: transcript,
            RewrittenTranscript: undefined,
            ParaphrasedTranscript: undefined,
        };

        try {
            await this.writeTranscriptContent(filePath, transcriptContent, mostRecentLeaf);
            new Notice(`Transcript saved to ${filePath}`);
            new Notice("Starting indexing transcript for readability");

            // Trigger indexing (non-blocking)
            this.indexTranscript(filePath).catch(err => {
                console.error('Indexing transcript failed:', err);
                new Notice('Indexing transcript failed. See console for details.');
            });
        } catch (err) {
            console.error('Failed to save transcript:', err);
            new Notice('Failed to save transcript. See console for details.');
            throw err;
        }
    }
    public async indexTranscript(filePath: string) {
        // Placeholder for indexing logic
        console.log(`Indexing transcript at ${filePath}...`);

        if (!this.aiclient) {
            new Notice('AI client not available; skipping transcript indexing.');
            return;
        }
        const transcript = await this.unmarshalTranscriptContent(filePath);
        // guard: ensure there is source transcript text to work with
        const sourceText = (transcript.SourceTranscript || '').trim();
        if (!sourceText) {
            console.warn('Indexing aborted: source transcript is empty.');
            new Notice('Indexing skipped: transcript appears empty.');
            return;
        }

        // split into chunks of ~500 words for rewriting
        const words = sourceText.split(/\s+/);
        const chunkSize = 500;
        const chunks = [];
        for (let i = 0; i < words.length; i += chunkSize) {
            chunks.push(words.slice(i, i + chunkSize).join(' '));
        }
        console.log(chunks)

        // get general context for chunk rewriting as well as some metadata for frontmatter
        const general_summary_response = await this.aiclient.chatCompletion('gpt-4', [
            {
                role: 'system', content: `You are an assistant that reads an entire lecture transcript and extracts key context for understanding it.

Your tasks:

1. Identify the **speaker**:
   - Full name if available
   - Role, affiliation, or background mentioned in the transcript
2. Provide a **general summary** of the lecture:
   - Include the main topics, goals, and purpose
   - Capture key themes or ideas that span the whole transcript
   - Do not go into paragraph-level detail; this is high-level context
3. Return the output in JSON format:

{
  "speaker": {
    "name": "...",
    "role": "...",
    "background": "..."
  },
  "general_summary": "..."
}`}, {
                role: 'user', content: `Here is the full transcript:\n\n${transcript.SourceTranscript}`
            }
        ])

        interface SummaryResponse {
            speaker: {
                name: string;
                role: string;
                background: string;
            };
            general_summary: string;
        }
        // AIClient.chatCompletion returns assistant text as a string. Guard against empty/invalid responses.
        const general_summary_text = (general_summary_response as unknown as string) || '';
        let general_summary: SummaryResponse | null = null;
        if (!general_summary_text.trim()) {
            console.warn('Empty general summary response from AI. Skipping general summary.');
            new Notice('Indexing: AI returned an empty general summary. Skipping summary parse.');
        } else {
            // Try to find a JSON substring inside the assistant response. Some models reply with text around JSON.
            const jsonStart = general_summary_text.indexOf('{');
            const jsonEnd = general_summary_text.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                const possibleJson = general_summary_text.slice(jsonStart, jsonEnd + 1);
                try {
                    general_summary = JSON.parse(possibleJson) as SummaryResponse;
                    console.log('General Summary Response (extracted JSON):', general_summary);
                } catch (err) {
                    console.error('Failed to parse extracted JSON from AI response:', err, possibleJson);
                    console.error('Full AI response:', general_summary_text);
                    new Notice('Indexing: AI returned invalid JSON for general summary. See console for details.');
                }
            } else {
                console.error('No JSON object detected in AI general summary response:', general_summary_text);
                new Notice('Indexing: AI did not return JSON for general summary. See console for details.');
            }
        }


    // simulate rewriting each chunk
    const summaryChunks: string[] = [];
        for (const [index, chunk] of chunks.entries()) {
            // skip empty chunks
            if (!chunk || !chunk.trim()) {
                console.warn(`Skipping empty chunk ${index + 1}`);
                continue;
            }
            console.log(`Indexing chunk ${index + 1}/${chunks.length}...`);
            const summaryChunkRaw = await this.aiclient.chatCompletion('gpt-4o-mini', [
                { role: 'system', content: `You are an assistant that converts spoken lecture transcript chunks into clear, readable text.

Your tasks:

1. Fix grammar, punctuation, and sentence structure.
2. Remove filler words and speech disfluencies (e.g., "uh", "um", "you know", "like").
3. Combine broken or run-on sentences into smooth, understandable sentences.
4. Preserve all key points, technical terms, examples, and numbers.
5. Organize text into logical paragraphs by topic or idea.
6. Optionally, add minor clarifying words or connectors to improve flow, without changing the meaning.

**Important:** Do NOT summarize, omit, or invent content. This is a **faithful, readable rewrite**, not a summary.`},
                { role: 'user', content: `Here is a chunk of the transcript:\n\n${chunk}` }
            ])
            const summaryChunk = (summaryChunkRaw as unknown as string) || '';
            // guard: if the model asks for missing input (common when chunk is empty), skip
            const lower = summaryChunk.trim().toLowerCase();
            if (!summaryChunk.trim() || lower.includes('please provide') || lower.includes('transcript') && lower.includes('missing')) {
                console.warn(`AI returned a prompt/empty response for chunk ${index + 1}:`, summaryChunk);
                continue;
            }
            summaryChunks.push(summaryChunk);
            await new Promise(resolve => setTimeout(resolve, 500)); // simulate delay
        }
        console.log(summaryChunks)

        // save rewritten transcript back to file or elsewhere as needed
        transcript.RewrittenTranscript = summaryChunks.join('\n\n');
        if (general_summary && general_summary.speaker) {
            transcript.speaker = general_summary.speaker;
        }
        await this.writeTranscriptContent(filePath, transcript);
        new Notice(`Indexing complete for transcript at ${filePath}`);




    }

    async unmarshalTranscriptContent(filePath: string): Promise<TranscriptContent> {
        const content = await this.app.vault.adapter.read(filePath)
        // Accept multiple possible headings used by the writer. The file may contain:
        // - "# Paraphrased Summary"
        // - "## Rewrites" or "# Rewritten Transcript"
        // - "## Original Transcript" or "# Source Transcript"

        // Try to find Original / Source transcript block (fenced code)
        const sourceRe = /(?:##\s*Original Transcript|#\s*Source Transcript)[\s\S]*?```([\s\S]*?)```/i;
        const sourceMatch = sourceRe.exec(content);

        // Try to find Rewritten / Rewrites block
        const rewrittenRe = /(?:##\s*Rewrites|#\s*Rewritten Transcript)[\s\S]*?```([\s\S]*?)```/i;
        const rewrittenMatch = rewrittenRe.exec(content);

        const sourceTranscript = sourceMatch ? (sourceMatch[1] || sourceMatch[0]) : '';
        const rewrittenTranscript = rewrittenMatch ? (rewrittenMatch[1] || rewrittenMatch[0]) : undefined;

        // extract frontmatter
        const fmRe = /^---\n([\s\S]*?)\n---\n?/;
        const fmMatch = fmRe.exec(content);
        const speaker = { name: '', role: '' };
        if (fmMatch) {
            try {
                const fmData = load(fmMatch[1]) as Record<string, unknown>;
                if (fmData) {
                    // speaker may be a string or an object
                    if (typeof fmData.speaker === 'string') {
                        speaker.name = fmData.speaker;
                    } else if (fmData.speaker && typeof fmData.speaker === 'object') {
                        const sp = fmData.speaker as Record<string, unknown>;
                        if (typeof sp.name === 'string') speaker.name = sp.name;
                        if (typeof sp.role === 'string') speaker.role = sp.role;
                    } else if (typeof fmData['speaker.name'] === 'string') {
                        // handle flattened frontmatter keys
                        speaker.name = fmData['speaker.name'] as string;
                    }
                }
            } catch (e) {
                console.warn('Failed to parse frontmatter for transcript content', e);
            }
        }
        
        return {
            speaker,
            ParaphrasedTranscript: undefined,
            SourceTranscript: sourceTranscript,
            RewrittenTranscript: rewrittenTranscript || undefined,
        };
        


    }

    async writeTranscriptContent(filePath: string, content: TranscriptContent, sourceLeaf?: WorkspaceLeaf) {
        // Build frontmatter
        const frontmatter = {
            speaker: content.speaker?.name ?? '',
            date: new Date().toISOString().slice(0, 10),
        };
        const yaml = dump(frontmatter, { lineWidth: -1 });

        // Build markdown body
        let fileBody = `---\n${yaml}---\n\n`;
        // Paraphrased Summary section
        if (content.ParaphrasedTranscript) {
            fileBody += `# Paraphrased Summary\n\n${content.ParaphrasedTranscript}\n\n`;
        } else {
            fileBody += `# Paraphrased Summary\n\n\n`;
        }

        // Rewrites
        if (content.RewrittenTranscript) {
            fileBody += `## Rewrites\n\n${content.RewrittenTranscript}\n\n`;
        } else {
            fileBody += `## Rewrites\n\n\n`;
        }

        // Source transcript
        fileBody += `## Original Transcript\n\n\`\`\`${content.SourceTranscript}\`\`\``;

        // Write file
        await this.app.vault.adapter.write(filePath, fileBody);

        // Update frontmatter in source leaf if provided
        try {
            const view = sourceLeaf?.view as MarkdownView | null;
            const activeFile = view?.file as TFile | null;
            if (activeFile) {
                const original = await this.app.vault.read(activeFile);
                const fmRegex = /^---\n([\s\S]*?)\n---\n?/;
                const fmData = {
                    transcript: filePath,
                    transcript_link: `[[${filePath.replace(/\.md$/, '')}]]`,
                };

                const match = fmRegex.exec(original);
                let newContent: string;
                if (match) {
                    let existing: Record<string, unknown> = {};
                    try {
                        existing = (load(match[1]) as Record<string, unknown>) || {};
                    } catch (e) {
                        existing = {};
                    }
                    const merged = Object.assign({}, existing, fmData);
                    const newYaml = dump(merged, { lineWidth: -1 });
                    const rest = original.slice(match[0].length);
                    newContent = `---\n${newYaml}---\n\n${rest}`;
                } else {
                    const newYaml = dump(fmData, { lineWidth: -1 });
                    newContent = `---\n${newYaml}---\n\n${original}`;
                }

                await this.app.vault.modify(activeFile, newContent);
                new Notice(`Updated frontmatter in ${activeFile.path} with transcript link.`);
            }
        } catch (e) {
            console.error('Failed to update source file frontmatter:', e);
            new Notice('Failed to update source file frontmatter. See console.');
        }
    }

}
