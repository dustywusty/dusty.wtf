export const OVERLAY_ID = "mud-ws-overlay";

const STYLE_ID = "mud-ws-style";

export function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
#${OVERLAY_ID}{
  position:fixed;
  right:12px;
  bottom:12px;
  width:min(700px,95vw);
  height:min(60vh,70vh);
  z-index:2147483647;
  font-family:ui-monospace,Menlo,Consolas,monospace;
  background:var(--mud-panel,var(--mud-bg,#0b0f12));
  color:var(--mud-text,#e6edf3);
  border:1px solid var(--mud-border,#2d3741);
  border-radius:12px;
  box-shadow:0 12px 36px var(--mud-shadow,rgba(15,17,21,.6));
  display:flex;
  flex-direction:column;
  overflow:hidden;
  resize:both;
}
#${OVERLAY_ID} .head{
  display:flex;
  gap:8px;
  align-items:center;
  padding:10px;
  background:var(--mud-panel,#0f1419);
  border-bottom:1px solid var(--mud-border,#2d3741);
}
#${OVERLAY_ID} .status-panel{
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:10px;
  background:var(--mud-panel,#0f1419);
  border-bottom:1px solid var(--mud-border,#2d3741);
  font-size:13px;
  color:var(--mud-text,#e6edf3);
}
#${OVERLAY_ID} .health-container{
  display:flex;
  align-items:center;
  gap:10px;
}
#${OVERLAY_ID} .health-text{
  min-width:100px;
  font-weight:600;
  opacity:1;
}
#${OVERLAY_ID} .level-text{
  min-width:100px;
  font-weight:600;
  opacity:1;
}
#${OVERLAY_ID} .xp-bar-bg{
  flex:1;
  height:12px;
  background:var(--mud-bg,#0b0f12);
  border:1px solid var(--mud-border,#2d3741);
  border-radius:6px;
  overflow:hidden;
  position:relative;
}
#${OVERLAY_ID} .xp-bar{
  height:100%;
  background:var(--mud-health-bar,#29e3c7);
  opacity:1;
  transition:width 0.3s ease;
  border-radius:4px;
}
#${OVERLAY_ID} .level-container{
  display:flex;
  align-items:center;
  gap:10px;
}
#${OVERLAY_ID} .health-bar-bg{
  flex:1;
  height:12px;
  background:var(--mud-bg,#0b0f12);
  border:1px solid var(--mud-border,#2d3741);
  border-radius:6px;
  overflow:hidden;
  position:relative;
}
#${OVERLAY_ID} .health-bar{
  height:100%;
  background:var(--mud-health-bar,#29e3c7);
  transition:width 0.3s ease, background-color 0.3s ease;
  border-radius:4px;
}
#${OVERLAY_ID} .area-text{
  opacity:0.8;
  font-size:12px;
}
#${OVERLAY_ID} .effects-text{
  font-size:12px;
  color:var(--mud-sys,#fbbf24);
}
#${OVERLAY_ID} .status{
  padding:6px 10px;
  border:1px solid var(--mud-border,#2d3741);
  border-radius:999px;
  background:var(--mud-bg,#0b0f12);
  color:var(--mud-status-idle,#9da7b3);
  font-size:13px;
  line-height:1;
  display:inline-flex;
  align-items:center;
  gap:6px;
  transition:color .15s ease,border-color .15s ease,background-color .15s ease;
}
#${OVERLAY_ID} .status.status-connecting{color:var(--mud-status-connecting,#d29922);}
#${OVERLAY_ID} .status.status-connected{color:var(--mud-status-connected,#3fb950);}
#${OVERLAY_ID} .status.status-error{
  color:var(--mud-status-error,#ff7b72);
  border-color:var(--mud-status-error,#ff7b72);
}
#${OVERLAY_ID} .url{
  flex:1;
  background:var(--mud-input-bg,#0b0f12);
  color:var(--mud-text,#e6edf3);
  border:1px solid var(--mud-border,#2d3741);
  border-radius:10px;
  padding:8px 10px;
  font-size:13px;
  line-height:1.3;
  transition:border-color .15s ease,box-shadow .15s ease;
}
#${OVERLAY_ID} .url:focus-visible{
  outline:none;
  border-color:var(--mud-border-strong,#3b4855);
  box-shadow:0 0 0 3px var(--mud-focus-ring,rgba(41,227,199,.35));
}
#${OVERLAY_ID} .btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  background:var(--mud-btn-bg,#192129);
  color:var(--mud-text,#e6edf3);
  border:1px solid var(--mud-btn-border,#2d3741);
  border-radius:10px;
  padding:8px 12px;
  font-size:13px;
  line-height:1.1;
  cursor:pointer;
  transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .1s ease;
}
#${OVERLAY_ID} .btn:hover{
  background:var(--mud-btn-hover-bg,#1f2a33);
  border-color:var(--mud-border-strong,#3b4855);
}
#${OVERLAY_ID} .btn:focus-visible{
  outline:none;
  border-color:var(--mud-border-strong,#3b4855);
  box-shadow:0 0 0 3px var(--mud-focus-ring,rgba(41,227,199,.35));
}
#${OVERLAY_ID} .btn:active{transform:translateY(1px);}
#${OVERLAY_ID} .btn-primary{
  background:var(--mud-btn-primary-bg,#1f4b47);
  border-color:var(--mud-btn-primary-border,#2e605a);
  color:var(--mud-btn-primary-text,#0f1115);
}
#${OVERLAY_ID} .btn-primary:hover{
  background:var(--mud-btn-primary-hover-bg,#225f58);
  border-color:var(--mud-btn-primary-hover-border,var(--mud-btn-primary-border,#2e605a));
}
#${OVERLAY_ID} .btn-muted{
  background:transparent;
  color:var(--mud-text-muted,#9da7b3);
  border-color:var(--mud-border,#2d3741);
}
#${OVERLAY_ID} .btn-muted:hover{
  background:var(--mud-panel-strong,var(--mud-panel,#0f1419));
  color:var(--mud-text,#e6edf3);
}
#${OVERLAY_ID} .btn-icon{
  width:40px;
  padding:8px 0;
  display:flex;
  align-items:center;
  justify-content:center;
}
#${OVERLAY_ID} .out{
  white-space:pre-wrap;
  line-height:1.35;
  padding:12px 14px;
  height:100%;
  overflow:auto;
  font-size:13px;
  background:var(--mud-bg,#0b0f12);
  border-bottom:1px solid var(--mud-border,#2d3741);
}
#${OVERLAY_ID} .line{
  display:grid;
  grid-template-columns:max-content 1fr;
  align-items:flex-start;
  gap:12px;
  padding:2px 0;
}
#${OVERLAY_ID} .ts{
  color:var(--mud-text-muted,#9da7b3);
  font-size:12px;
  font-variant-numeric:tabular-nums;
  min-width:var(--mud-ts-min-width,11ch);
  text-align:right;
  white-space:nowrap;
  padding-top:2px;
}
#${OVERLAY_ID} .msg{
  white-space:pre-wrap;
  word-break:break-word;
}
#${OVERLAY_ID} .line-death{
  position:relative;
  padding:6px 10px;
  margin:6px -6px;
  border-radius:10px;
  overflow:hidden;
}
#${OVERLAY_ID} .line-death::before{
  content:"";
  position:absolute;
  inset:0;
  background:var(--mud-death-bg,rgba(255,123,114,.16));
  border-left:3px solid var(--mud-death-border,rgba(255,123,114,.45));
  border-radius:10px;
  box-shadow:0 6px 20px rgba(255,123,114,.25);
  pointer-events:none;
}
#${OVERLAY_ID} .line-death > *{
  position:relative;
}
#${OVERLAY_ID} .line-death .ts{
  color:var(--mud-death-text,var(--mud-err,#ff7b72));
}
#${OVERLAY_ID} .line-death .msg{
  color:var(--mud-death-text,var(--mud-err,#ff7b72));
}
#${OVERLAY_ID} .msg.death{
  font-weight:600;
  text-shadow:0 0 12px rgba(255,123,114,.4);
}
#${OVERLAY_ID} .out::-webkit-scrollbar{width:10px;}
#${OVERLAY_ID} .out::-webkit-scrollbar-thumb{
  background:var(--mud-scroll-thumb,rgba(150,150,150,.35));
  border-radius:999px;
}
#${OVERLAY_ID} .in{
  display:grid;
  grid-template-columns:1fr auto auto;
  gap:8px;
  padding:10px;
  border-top:1px solid var(--mud-border,#2d3741);
  background:var(--mud-panel-strong,var(--mud-panel,#0f1419));
}
#${OVERLAY_ID} textarea{
  height:56px;
  resize:none;
  background:var(--mud-input-bg,#0b0f12);
  color:var(--mud-text,#e6edf3);
  border:1px solid var(--mud-border,#2d3741);
  border-radius:10px;
  padding:10px;
  font:13px/1.3 inherit;
  transition:border-color .15s ease,box-shadow .15s ease;
}
#${OVERLAY_ID} textarea:focus-visible{
  outline:none;
  border-color:var(--mud-border-strong,#3b4855);
  box-shadow:0 0 0 3px var(--mud-focus-ring,rgba(41,227,199,.35));
}
#${OVERLAY_ID} .sys{color:var(--mud-sys,#9da7b3);}
#${OVERLAY_ID} .err{color:var(--mud-err,#ff7b72);}
#${OVERLAY_ID} .inl{color:var(--mud-in,#79c0ff);}
#${OVERLAY_ID} .outl{color:var(--mud-text,#e6edf3);}
#${OVERLAY_ID} .gap{
  margin:8px 0;
  border-top:1px dashed var(--mud-gap-color,rgba(100,110,120,.4));
}
#${OVERLAY_ID}.embedded{
  position:static;
  right:auto;
  bottom:auto;
  width:100%;
  max-width:none;
  height:60vh;
  margin:16px 0 0;
  resize:vertical;
  box-shadow:none;
}`;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}
