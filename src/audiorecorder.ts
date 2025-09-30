

export class AudioRecorder {
	private audioContext: AudioContext | null = null;
	private scriptNode: ScriptProcessorNode | null = null;
	private mediaStream: MediaStream | null = null;
	private ws: WebSocket | null = null;
	private AssemblyAPIKey: string = '';

	constructor(assembyAPIKey?: string) {
		this.AssemblyAPIKey = assembyAPIKey ?? '';
	}

	// Allow updating the API key at runtime
	public setAssemblyAPIKey(apiKey: string) {
		this.AssemblyAPIKey = apiKey ?? '';
	}

	// Separate transcript management
	private completedTurns: string[] = []; // Finalized turns
	private currentTurn: string = ''; // Live updating current turn
	private currentTurnOrder: number = -1; // Track which turn we're on

	// Callback for live updates
	public onTranscriptUpdate: ((fullTranscript: string) => void) | null = null;

	async startRecording() {
		if (!navigator.mediaDevices?.getUserMedia) {
			throw new Error("Audio Recording is not supported on this device.");
		}
		this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		this.audioContext = new AudioContext({ sampleRate: 16000 });
		const source = this.audioContext.createMediaStreamSource(this.mediaStream);
		this.scriptNode = this.audioContext.createScriptProcessor(4096, 1, 1);

		this.ws = await this.initAssemblyAIWebSocket();

		// Set up the WebSocket message handler
		this.setupWebSocketHandlers();

		this.scriptNode.onaudioprocess = (audioProcessingEvent) => {
			const inputBuffer = audioProcessingEvent.inputBuffer;
			const inputData = inputBuffer.getChannelData(0);
			const pcmBuffer = this.floatTo16BitPCM(inputData);
			if (this.ws && this.ws.readyState === WebSocket.OPEN) {
				this.ws.send(pcmBuffer);
			}
		};

		source.connect(this.scriptNode);
		this.scriptNode.connect(this.audioContext.destination);
		console.log("Recording started (PCM streaming).");
	}

	async stopRecording() {
		if (this.scriptNode) {
			this.scriptNode.disconnect();
			this.scriptNode.onaudioprocess = null;
			this.scriptNode = null;
		}
		if (this.audioContext) {
			await this.audioContext.close();
			this.audioContext = null;
		}
		if (this.mediaStream) {
			this.mediaStream.getTracks().forEach(track => track.stop());
			this.mediaStream = null;
		}
		console.log("Recording stopped.");

		if (this.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.ws.readyState as 0 | 1)) {
			console.log("Closing WebSocket connection.");
			const terminateMessage = { type: "Terminate" }
			this.ws.send(JSON.stringify(terminateMessage));
			this.ws.close();
		}

		// Finalize any remaining current turn
		const transcript = this.getFullTranscript();
		return transcript;


	}

	private async initAssemblyAIWebSocket(): Promise<WebSocket> {
		const apiUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&formatTurns=true&token=${encodeURIComponent(this.AssemblyAPIKey)}`;
		const ws = new WebSocket(apiUrl);

		return new Promise((resolve, reject) => {
			ws.onopen = () => {
				console.log("WebSocket connection opened");
				resolve(ws);
			};
			ws.onerror = (error) => {
				reject(new Error("WebSocket connection error: " + error));
			}
		});


	}

	private floatTo16BitPCM(input: Float32Array): ArrayBuffer {
		const buffer = new ArrayBuffer(input.length * 2);
		const view = new DataView(buffer);
		for (let i = 0; i < input.length; i++) {
			let s = Math.max(-1, Math.min(1, input[i]));
			view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); // little-endian
		}
		return buffer;
	}

	private setupWebSocketHandlers() {
		if (!this.ws) return;

		this.ws.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);
				console.log("Received message:", message);

				if (message.type === "Turn") {
					this.handleTurnMessage(message);
				}
			} catch (error) {
				console.error("Error parsing WebSocket message:", error);
			}
		};
	}

	private handleTurnMessage(message: AssemblyAIWebSocketMessage): void {
		// Check if we're starting a new turn
		if (message.turn_order !== this.currentTurnOrder) {
			// New turn started - finalize the previous one if it exists
			if (this.currentTurnOrder >= 0 && this.currentTurn.trim()) {
				this.completedTurns.push(this.currentTurn.trim());
			}

			// Start tracking the new turn
			this.currentTurnOrder = message.turn_order;
			this.currentTurn = message.transcript || '';
		} else {
			// Update the current turn with new transcript
			this.currentTurn = message.transcript || '';
		}

		// If this turn is complete, finalize it
		if (message.end_of_turn) {
			if (this.currentTurn.trim()) {
				this.completedTurns.push(this.currentTurn.trim());
			}
			this.currentTurn = '';
			this.currentTurnOrder = -1;
		}

		// Trigger live update
		this.updateLiveTranscript();
	}

	private updateLiveTranscript(): void {
		// Combine completed turns with current live turn
		const fullTranscript = [
			...this.completedTurns,
			...(this.currentTurn.trim() ? [this.currentTurn] : [])
		].join('\n\n');

		if (this.onTranscriptUpdate) {
			this.onTranscriptUpdate(fullTranscript);
		}
	}

	// Public method to get the full transcript at any time
	public getFullTranscript(): string {
		return [
			...this.completedTurns,
			...(this.currentTurn.trim() ? [this.currentTurn] : [])
		].join('\n\n');
	}

	// Public method to get the current turn
	public getCurrentTurn(): string {
		return this.currentTurn;
	}

	// Clear transcript (useful for new recordings)
	public clearTranscript(): void {
		this.completedTurns = [];
		this.currentTurn = '';
		this.currentTurnOrder = -1;
		this.updateLiveTranscript();
	}
}

type AssemblyAIWebSocketMessage = {
	type: 'Turn',
	turn_order: number,
	turn_is_formatted: boolean,
	end_of_turn: boolean,
	transcript: string // all the final words in a turn
}