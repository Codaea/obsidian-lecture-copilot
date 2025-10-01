export interface ConversationMessage {
    role: 'developer' | 'user' | 'assistant';
    content: string;
}

export interface TranscriptionStats {
    duration: number;
    wordCount: number;
}