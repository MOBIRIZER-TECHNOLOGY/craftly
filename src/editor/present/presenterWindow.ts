export type PresenterCommand = "next" | "previous";

export interface PresenterWindowState {
  index: number;
  count: number;
  notes: string;
  nextName: string;
  nextImage?: string;
}

export function presenterWindowHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Presenter notes</title><style>*{box-sizing:border-box}body{margin:0;background:#111418;color:#f2f4f7;font:16px/1.5 system-ui,sans-serif}main{display:grid;grid-template-columns:1fr 1fr;gap:24px;max-width:1100px;margin:auto;padding:28px}h1{font-size:18px}h2{font-size:13px;color:#aab2bf;text-transform:uppercase;letter-spacing:.06em}p{white-space:pre-wrap;overflow-wrap:anywhere}img{display:block;max-width:100%;max-height:65vh;margin:auto}nav{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:16px}button{padding:10px 18px;border:1px solid #4b5563;border-radius:8px;background:#1b1f26;color:inherit;cursor:pointer}button:hover{background:#2a303a}#empty{color:#aab2bf}@media(max-width:700px){main{grid-template-columns:1fr}}</style></head><body><main><section><h1 id="count"></h1><h2>Speaker notes</h2><p id="notes"></p></section><section><h2>Next page</h2><p id="next-name"></p><img id="next-image" alt="Next page preview" hidden></section><nav><button id="previous" type="button">Previous</button><button id="next" type="button">Next</button></nav></main><script>(function(){var channel=new BroadcastChannel("craftly-presenter");channel.onmessage=function(event){var state=event.data;document.getElementById("count").textContent="Page "+(state.index+1)+" of "+state.count;document.getElementById("notes").textContent=state.notes||"No notes for this page.";document.getElementById("next-name").textContent=state.nextName;var image=document.getElementById("next-image");if(state.nextImage){image.src=state.nextImage;image.hidden=false}else{image.removeAttribute("src");image.hidden=true}};document.getElementById("previous").onclick=function(){channel.postMessage("previous")};document.getElementById("next").onclick=function(){channel.postMessage("next")};document.addEventListener("keydown",function(event){if(event.key==="ArrowLeft")channel.postMessage("previous");if(event.key==="ArrowRight"||event.key===" ")channel.postMessage("next")});})();</script></body></html>`;
}

export class PresenterWindow {
  private channel: BroadcastChannel | null = null;
  private popup: Window | null = null;

  open(onCommand: (command: PresenterCommand) => void): boolean {
    if (this.popup && !this.popup.closed) {
      this.popup.focus();
      return true;
    }
    this.popup = window.open("", "craftly-presenter", "popup,width=1100,height=760");
    if (!this.popup) return false;
    this.popup.document.write(presenterWindowHtml());
    this.popup.document.close();
    this.channel = new BroadcastChannel("craftly-presenter");
    this.channel.onmessage = (event) => onCommand(event.data as PresenterCommand);
    return true;
  }

  post(state: PresenterWindowState): void {
    this.channel?.postMessage(state);
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.popup?.close();
    this.popup = null;
  }
}
