const PLACEHOLDER_IMAGE_URL = `/extensions/Civicomfy/images/placeholder.jpeg`;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export function showDetailsModal(ui, details, _card) {
  if (!details || details.success === false) return;

  // Pull fields with fallbacks
  const modelId = details.model_id;
  const versionId = details.version_id;
  const name = details.model_name || 'Untitled Model';
  const creator = details.creator_username || 'Unknown Creator';
  const civitaiUrl = details.civitai_url || (modelId ? `https://civitai.com/models/${modelId}${versionId ? '?modelVersionId=' + versionId : ''}` : null);
  const type = details.model_type || '';
  const baseModel = details.base_model || '';
  const versionName = details.version_name || '';
  const stats = details.stats || {};
  const publishedAt = formatDate(details.published_at);
  const updatedAt = formatDate(details.updated_at);
  const tags = Array.isArray(details.tags) ? details.tags.map(t => typeof t === 'string' ? t : (t && typeof t.name === 'string' ? t.name : '')).filter(Boolean) : [];
  const trainedWords = Array.isArray(details.trained_words) ? details.trained_words : [];
  const images = Array.isArray(details.images) ? details.images : [];
  const descHtml = details.description_html || '<p><em>No description.</em></p>';
  const versionDescHtml = details.version_description_html || '<p><em>No version description.</em></p>';

  const overlay = document.createElement('div');
  overlay.className = 'civi-details-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 9999;
    display: flex; align-items: center; justify-content: center; padding: 24px;`;

  const modal = document.createElement('div');
  modal.className = 'civi-details-modal';
  modal.style.cssText = `
    background: var(--comfy-menu-bg, #222); color: var(--fg-color, #ddd);
    width: min(1100px, 96%); max-height: 90vh; overflow: hidden;
    border: 1px solid var(--border-color, #555); border-radius: 8px; display: flex; flex-direction: column;`;

  const header = document.createElement('div');
  header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border-color, #555);';
  header.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <div style="font-weight:700; font-size:1.1rem;">${escapeHtml(name)}</div>
      ${creator ? `<div style="opacity:0.8;">by ${escapeHtml(creator)}</div>` : ''}
    </div>
    <div style="display:flex; gap:8px;">
      ${civitaiUrl ? `<a href="${escapeHtml(civitaiUrl)}" target="_blank" rel="noopener noreferrer" class="civi-btn" title="Open on Civitai" aria-label="Open on Civitai" style="padding:6px 10px;">
        <i class="fas fa-external-link-alt"></i>
      </a>` : ''}
      <button type="button" class="civi-btn civi-details-close" title="Close" aria-label="Close" style="padding:6px 10px;">
        <i class="fas fa-times"></i>
      </button>
    </div>`;

  const body = document.createElement('div');
  body.style.cssText = 'display:flex; gap:16px; padding:12px 16px; overflow:auto;';

  const left = document.createElement('div');
  left.style.cssText = 'flex: 1 1 58%; display:flex; flex-direction:column; gap:12px; min-width: 320px;';

  const right = document.createElement('div');
  right.style.cssText = 'flex: 1 1 42%; display:flex; flex-direction:column; gap:12px; min-width: 280px;';

  // Left: Gallery and descriptions
  const gallery = document.createElement('div');
  gallery.style.cssText = 'display:flex; gap:8px; overflow-x:auto; padding-bottom:4px;';
  const openFullscreen = (src, type = 'image', promptText = '') => {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:8px;';
    const close = () => { try { document.body.removeChild(layer); } catch(e){} };
    const mediaWrap = document.createElement('div');
    mediaWrap.style.cssText = 'max-width:95vw;max-height:78vh;display:flex;align-items:center;justify-content:center;';
    let media;
    if (type && String(type).toLowerCase() === 'video') {
      media = document.createElement('video');
      media.src = src; media.controls = true; media.autoplay = false; media.style.cssText = 'max-width:95vw;max-height:78vh;';
    } else {
      media = document.createElement('img');
      media.src = src; media.alt = 'Preview'; media.style.cssText = 'max-width:95vw;max-height:78vh;';
      media.onerror = () => { media.src = PLACEHOLDER_IMAGE_URL; };
    }
    mediaWrap.appendChild(media);

    const caption = document.createElement('div');
    caption.style.cssText = 'max-width:95vw;max-height:16vh;overflow:auto;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);padding:10px;border-radius:6px;color:#ddd;font-size:0.95em;white-space:pre-wrap;';
    caption.textContent = promptText ? String(promptText) : 'No prompt info.';

    const topBar = document.createElement('div');
    topBar.style.cssText = 'position:absolute;top:10px;right:16px;';
    const x = document.createElement('button'); x.textContent = '\u00D7'; x.title = 'Close';
    x.style.cssText = 'font-size:24px;background:transparent;border:none;color:#fff;cursor:pointer;';
    x.addEventListener('click', close);
    topBar.appendChild(x);

    layer.appendChild(mediaWrap);
    layer.appendChild(caption);
    layer.appendChild(topBar);
    layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
    document.addEventListener('keydown', function onKey(e){ if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey);} });
    document.body.appendChild(layer);
    try { ui.ensureFontAwesome(); } catch (e) {}
  };

  if (images.length === 0) {
    const img = document.createElement('img');
    img.src = PLACEHOLDER_IMAGE_URL;
    img.alt = 'No images';
    img.style.cssText = 'max-height:220px; border-radius:6px; border:1px solid var(--border-color, #555);';
    gallery.appendChild(img);
  } else {
    images.slice(0, 12).forEach((info) => {
      const t = (info.type || '').toLowerCase();
      const src = info.url || PLACEHOLDER_IMAGE_URL;
      const promptText = info.prompt || '';
      if (t === 'video') {
        const video = document.createElement('video');
        video.src = src; video.controls = true; video.style.cssText = 'max-height:220px; border-radius:6px; border:1px solid var(--border-color, #555); background:#000;';
        video.addEventListener('click', (e) => { e.stopPropagation(); openFullscreen(src, 'video', promptText); });
        gallery.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.src = src; img.alt = name; img.loading = 'lazy';
        img.style.cssText = 'max-height:220px; border-radius:6px; border:1px solid var(--border-color, #555); background:#333;';
        img.onerror = () => { img.src = PLACEHOLDER_IMAGE_URL; img.style.backgroundColor = '#444'; };
        img.addEventListener('click', (e) => { e.stopPropagation(); openFullscreen(src, 'image', promptText); });
        gallery.appendChild(img);
      }
    });
  }

  const modelDesc = document.createElement('div');
  modelDesc.innerHTML = `<h4 style="margin:6px 0;">Model Description</h4><div style="max-height:240px; overflow:auto; border:1px solid var(--border-color, #555); border-radius:6px; padding:8px; background: var(--comfy-input-bg, #1e1e1e); font-size:0.95em;">${descHtml}</div>`;

  const versionDesc = document.createElement('div');
  versionDesc.innerHTML = `<h4 style="margin:6px 0;">Version Notes</h4><div style="max-height:200px; overflow:auto; border:1px solid var(--border-color, #555); border-radius:6px; padding:8px; background: var(--comfy-input-bg, #1e1e1e); font-size:0.95em;">${versionDescHtml}</div>`;

  left.appendChild(gallery);
  left.appendChild(modelDesc);
  left.appendChild(versionDesc);

  // Right: meta, stats, tags, triggers
  const meta = document.createElement('div');
  meta.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
  meta.innerHTML = `
    <div style="display:flex; gap:10px; flex-wrap:wrap; font-size:0.95em; color:#bbb;">
      ${type ? `<span><strong>Type:</strong> ${escapeHtml(type)}</span>` : ''}
      ${baseModel ? `<span><strong>Base:</strong> ${escapeHtml(baseModel)}</span>` : ''}
      ${versionName ? `<span><strong>Version:</strong> ${escapeHtml(versionName)}</span>` : ''}
      ${publishedAt ? `<span><strong>Published:</strong> ${escapeHtml(publishedAt)}</span>` : ''}
      ${updatedAt ? `<span><strong>Updated:</strong> ${escapeHtml(updatedAt)}</span>` : ''}
    </div>
    <div style="display:flex; gap:14px; flex-wrap:wrap; font-size:0.95em; margin-top:4px;">
      <span title="Downloads"><i class="fas fa-download"></i> ${Number(stats.downloads || 0).toLocaleString()}</span>
      <span title="Likes"><i class="fas fa-thumbs-up"></i> ${Number(stats.likes || 0).toLocaleString()}</span>
      <span title="Dislikes"><i class="fas fa-thumbs-down"></i> ${Number(stats.dislikes || 0).toLocaleString()}</span>
      <span title="Buzz"><i class="fas fa-bolt"></i> ${Number(stats.buzz || 0).toLocaleString()}</span>
    </div>
  `;

  const tagWrap = document.createElement('div');
  tagWrap.innerHTML = `<h4 style="margin:6px 0;">Tags</h4>`;
  const tagList = document.createElement('div');
  tagList.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap;';
  if (tags.length === 0) {
    const span = document.createElement('span');
    span.textContent = 'No tags';
    span.style.opacity = '0.8';
    tagList.appendChild(span);
  } else {
    tags.slice(0, 20).forEach(tag => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'civi-btn';
      pill.textContent = tag;
      pill.title = 'Click to copy tag';
      pill.style.cssText = 'background: rgba(92,138,255,0.15); border:1px solid rgba(92,138,255,0.4); border-radius:999px; padding:4px 10px; font-size:0.85em;';
      pill.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(tag); ui.showToast(`${tag} copied`, 'success'); } catch { ui.showToast('Copy failed', 'error'); }
      });
      tagList.appendChild(pill);
    });
  }
  tagWrap.appendChild(tagList);

  const trigWrap = document.createElement('div');
  trigWrap.innerHTML = `<h4 style="margin:6px 0;">Trained Words</h4>`;
  const trigList = document.createElement('div');
  trigList.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap;';
  if (trainedWords.length === 0) {
    const span = document.createElement('span');
    span.textContent = 'None';
    span.style.opacity = '0.8';
    trigList.appendChild(span);
  } else {
    trainedWords.slice(0, 20).forEach(word => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'civi-btn';
      pill.textContent = word;
      pill.title = 'Click to copy trigger';
      pill.style.cssText = 'background: rgba(92,138,255,0.15); border:1px solid rgba(92,138,255,0.4); border-radius:999px; padding:4px 10px; font-size:0.85em;';
      pill.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(word); ui.showToast(`${word} copied`, 'success'); } catch { ui.showToast('Copy failed', 'error'); }
      });
      trigList.appendChild(pill);
    });
  }
  trigWrap.appendChild(trigList);

  right.appendChild(meta);
  right.appendChild(tagWrap);
  right.appendChild(trigWrap);

  body.appendChild(left);
  body.appendChild(right);

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const remove = () => { try { document.body.removeChild(overlay); } catch(e){} };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) remove();
  });
  const closeBtn = header.querySelector('.civi-details-close');
  if (closeBtn) closeBtn.addEventListener('click', remove);
  document.addEventListener('keydown', function onKey(e){ if (e.key === 'Escape') { remove(); document.removeEventListener('keydown', onKey);} });

  try { ui.ensureFontAwesome(); } catch (e) {}
}
