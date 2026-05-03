// JG Lightbox & Download — standalone helpers for portal pages
// Drop in before the closing </body> on any HTML page.
window.JG = window.JG || {};

JG.openLightbox = function(images, startIdx) {
  if (!images || !images.length) return;
  let idx = startIdx || 0;

  let lb = document.getElementById('jgLightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'jgLightbox';
    lb.className = 'jg-lightbox';
    lb.innerHTML = `
      <button class="jg-lb-close" aria-label="Close">✕</button>
      <button class="jg-lb-prev" aria-label="Previous">‹</button>
      <button class="jg-lb-next" aria-label="Next">›</button>
      <button class="jg-lb-dl" aria-label="Download">📥 Download</button>
      <div class="jg-lb-stage"><img class="jg-lb-img" alt=""></div>
      <div class="jg-lb-caption">
        <span class="jg-lb-name"></span>
        <span class="jg-lb-counter"></span>
      </div>
    `;
    document.body.appendChild(lb);

    if (!document.getElementById('jgLightboxStyles')) {
      const css = document.createElement('style');
      css.id = 'jgLightboxStyles';
      css.textContent = `
.jg-lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:100000;align-items:center;justify-content:center;}
.jg-lightbox.on{display:flex;}
.jg-lightbox .jg-lb-stage{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;padding:60px 80px;}
.jg-lightbox .jg-lb-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;user-select:none;-webkit-user-drag:none;}
.jg-lightbox button{position:fixed;background:rgba(255,255,255,.12);color:#fff;border:0;cursor:pointer;font-size:28px;width:56px;height:56px;border-radius:50%;transition:background .15s;z-index:100001;}
.jg-lightbox button:hover{background:rgba(255,255,255,.25);}
.jg-lightbox .jg-lb-close{top:20px;right:20px;font-size:22px;}
.jg-lightbox .jg-lb-prev{left:20px;top:50%;transform:translateY(-50%);}
.jg-lightbox .jg-lb-next{right:20px;top:50%;transform:translateY(-50%);}
.jg-lightbox .jg-lb-dl{bottom:20px;right:20px;width:auto;padding:0 18px;height:44px;font-size:14px;font-weight:600;border-radius:22px;background:#e85d04;}
.jg-lightbox .jg-lb-dl:hover{background:#d05303;}
.jg-lightbox .jg-lb-caption{position:fixed;bottom:30px;left:30px;color:#fff;font-size:13px;display:flex;flex-direction:column;gap:4px;max-width:calc(100% - 220px);}
.jg-lightbox .jg-lb-name{font-weight:600;}
.jg-lightbox .jg-lb-counter{font-size:11px;color:rgba(255,255,255,.7);}
@media (max-width:600px){
.jg-lightbox .jg-lb-stage{padding:40px 12px;}
.jg-lightbox button{width:44px;height:44px;font-size:22px;}
.jg-lightbox .jg-lb-prev{left:10px;}
.jg-lightbox .jg-lb-next{right:10px;}
.jg-lightbox .jg-lb-dl{bottom:10px;right:10px;padding:0 14px;height:38px;font-size:12px;}
.jg-lightbox .jg-lb-caption{left:10px;bottom:56px;max-width:calc(100% - 20px);}
}`;
      document.head.appendChild(css);
    }
  }

  const imgEl = lb.querySelector('.jg-lb-img');
  const nameEl = lb.querySelector('.jg-lb-name');
  const counterEl = lb.querySelector('.jg-lb-counter');

  const show = () => {
    imgEl.src = images[idx].url;
    nameEl.textContent = images[idx].name + (images[idx].category ? ' · ' + images[idx].category : '');
    counterEl.textContent = `${idx+1} / ${images.length}`;
    lb.querySelector('.jg-lb-prev').style.visibility = images.length > 1 ? 'visible' : 'hidden';
    lb.querySelector('.jg-lb-next').style.visibility = images.length > 1 ? 'visible' : 'hidden';
  };
  const close = () => { lb.classList.remove('on'); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') { idx = (idx - 1 + images.length) % images.length; show(); }
    else if (e.key === 'ArrowRight') { idx = (idx + 1) % images.length; show(); }
  };

  ['.jg-lb-prev', '.jg-lb-next', '.jg-lb-dl', '.jg-lb-close'].forEach(sel => {
    const old = lb.querySelector(sel);
    const nu = old.cloneNode(true);
    old.parentNode.replaceChild(nu, old);
  });
  lb.querySelector('.jg-lb-prev').addEventListener('click', () => { idx = (idx - 1 + images.length) % images.length; show(); });
  lb.querySelector('.jg-lb-next').addEventListener('click', () => { idx = (idx + 1) % images.length; show(); });
  lb.querySelector('.jg-lb-close').addEventListener('click', close);
  lb.querySelector('.jg-lb-dl').addEventListener('click', () => JG.downloadFile(images[idx].url, images[idx].name));
  lb.addEventListener('click', e => { if (e.target === lb) close(); });

  // Touch swipe
  let tStart = 0;
  imgEl.addEventListener('touchstart', e => { tStart = e.touches[0].clientX; }, { passive: true });
  imgEl.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tStart;
    if (Math.abs(dx) > 50) {
      if (dx < 0) { idx = (idx + 1) % images.length; show(); }
      else { idx = (idx - 1 + images.length) % images.length; show(); }
    }
  }, { passive: true });

  document.addEventListener('keydown', onKey);
  show();
  lb.classList.add('on');
};

JG.downloadFile = async function(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch ' + res.status);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || url.split('/').pop().split('?')[0] || 'download';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(blobUrl); a.remove(); }, 250);
  } catch (e) {
    console.error('download failed', e);
    window.open(url, '_blank');
  }
};
