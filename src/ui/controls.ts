import { Notice } from 'obsidian';

interface IControlsViewDependencies {
    clearTranscript(): void;
    resetScrollTracking(): void;
    startRecording(): Promise<void>;
    transcriptToFile(): Promise<void>;
}

export class ControlsUI {
    private view: IControlsViewDependencies;
    private startButton: HTMLButtonElement | null = null;
    private stopButton: HTMLButtonElement | null = null;
    private durationInterval: number | null = null;
    private durationEl: HTMLElement | null = null;

    constructor(view: IControlsViewDependencies) {
        this.view = view;
    }

    setup(container: HTMLElement): void {
        this.startButton = container.createEl("button", { text: "Start Recording" });
        this.stopButton = container.createEl("button", { text: "Stop Recording" });
        this.stopButton.hide();

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        if (!this.startButton || !this.stopButton) return;

        this.startButton.addEventListener("click", async () => {
            try {
                this.view.clearTranscript();
                this.view.resetScrollTracking();
                await this.view.startRecording();
                new Notice("Recording started!");
                this.startButton?.hide();
                this.stopButton?.show();
                this.startDurationTimer();
            } catch (error) {
                new Notice("Failed to start recording: " + (error instanceof Error ? error.message : String(error)));
                console.error(error);
            }
        });

        this.stopButton.addEventListener("click", async () => {
            try {
                await this.view.transcriptToFile();
            } catch (error) {
                new Notice("Failed to stop recording: " + (error instanceof Error ? error.message : String(error)));
                console.error(error);
            }
            this.stopButton?.hide();
            this.startButton?.show();
            this.stopDurationTimer();
        });
    }

    private startDurationTimer(): void {
        let duration = 0;
        this.durationInterval = window.setInterval(() => {
            duration++;
            if (this.durationEl) {
                const hours = Math.floor(duration / 3600);
                const minutes = Math.floor((duration % 3600) / 60);
                const seconds = Math.floor(duration % 60);
                this.durationEl.setText(`Duration: ${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
            }
        }, 1000);
    }

    private stopDurationTimer(): void {
        if (this.durationInterval) {
            clearInterval(this.durationInterval);
            this.durationInterval = null;
        }
    }

    setDurationElement(element: HTMLElement): void {
        this.durationEl = element;
    }
}