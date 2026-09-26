/**
 * @name Universal Favorites
 * @description Favorite everything
 * @author iron web10
 * @version 1.0.0
 */

(() => {
  const IC = window.IronCord;
  if (!IC) return;

  const SETTINGS_URL = "https://discord.com/api/v9/users/@me/settings-proto/2";
  let panelOpen = false;

  IC.utils.injectCSS(
    "ironcord-favorites-style",
    `
    .ironcord-fav-btn-floating{
      position:fixed; z-index:999997; display:none;
      background:rgba(0,0,0,.7); border:none; border-radius:6px;
      width:28px; height:28px; align-items:center; justify-content:center;
      cursor:pointer; transition:transform .1s ease, background .1s ease;
      font-size:15px; color:#fff; pointer-events:auto;
    }
    .ironcord-fav-btn-floating:hover{ transform:scale(1.12); background:rgba(88,101,242,.9); }
    .ironcord-fav-btn-floating.saved{ color:#faa61a; }

    .ironcord-fab{
      position:fixed; bottom:24px; right:24px; z-index:999998;
      width:52px; height:52px; border-radius:50%; background:#5865f2; color:#fff;
      display:flex; align-items:center; justify-content:center; font-size:22px;
      cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.4); border:none;
    }
    .ironcord-fab:hover{ background:#4752c4; }

    .ironcord-panel{
      position:fixed; bottom:88px; right:24px; width:340px; max-height:520px;
      background:#2b2d31; border-radius:12px; z-index:999998; display:none;
      flex-direction:column; box-shadow:0 8px 24px rgba(0,0,0,.5); overflow:hidden;
      font-family:"gg sans",sans-serif; color:#dbdee1;
    }
    .ironcord-panel.open{ display:flex; }
    .ironcord-panel-header{
      padding:12px 14px; font-weight:600; border-bottom:1px solid #1e1f22;
      display:flex; justify-content:space-between; align-items:center;
    }
    .ironcord-panel-header small{ display:block; font-weight:400; font-size:10.5px; color:#949ba4; margin-top:1px; }
    .ironcord-panel-tabs{ display:flex; gap:6px; padding:8px 10px; border-bottom:1px solid #1e1f22; }
    .ironcord-tab{
      background:#1e1f22; border:none; color:#b5bac1; padding:5px 10px; border-radius:6px;
      font-size:12px; cursor:pointer;
    }
    .ironcord-tab.active{ background:#5865f2; color:#fff; }
    .ironcord-panel-grid{
      display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; padding:10px;
      overflow-y:auto; flex:1;
    }
    .ironcord-panel-item{ position:relative; border-radius:6px; overflow:hidden; aspect-ratio:1/1; background:#1e1f22; }
    .ironcord-panel-item img, .ironcord-panel-item video{ width:100%; height:100%; object-fit:cover; }
    .ironcord-panel-item.text-item{
      display:flex; align-items:center; justify-content:center; padding:6px;
      font-size:10.5px; line-height:1.3; color:#dbdee1; text-align:center; overflow:hidden;
    }
    .ironcord-panel-item .del{
      position:absolute; top:2px; right:2px; background:rgba(0,0,0,.7); border:none; color:#fff;
      border-radius:4px; font-size:11px; width:18px; height:18px; cursor:pointer;
    }
    .ironcord-panel-empty{ padding:24px; text-align:center; color:#87898c; font-size:13px; }
    .ironcord-panel-loading{ padding:24px; text-align:center; color:#87898c; font-size:13px; }
    `
  );

  const b64 = {
    toBytes(str) {
      const bin = atob(str);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    fromBytes(bytes) {
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
  };

  const proto = {
    readVarint(buf, pos) {
      let result = 0n, shift = 0n;
      while (true) {
        const byte = buf[pos++];
        result |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7n;
      }
      return [result, pos];
    },
    writeVarint(value) {
      value = BigInt(value);
      const bytes = [];
      while (true) {
        let b = Number(value & 0x7fn);
        value >>= 7n;
        if (value !== 0n) bytes.push(b | 0x80);
        else {
          bytes.push(b);
          break;
        }
      }
      return Uint8Array.from(bytes);
    },
    concat(arrs) {
      const total = arrs.reduce((s, a) => s + a.length, 0);
      const out = new Uint8Array(total);
      let o = 0;
      for (const a of arrs) {
        out.set(a, o);
        o += a.length;
      }
      return out;
    },
    parseFields(buf) {
      const entries = [];
      let pos = 0;
      while (pos < buf.length) {
        const [tag, p1] = this.readVarint(buf, pos);
        pos = p1;
        const num = Number(tag >> 3n);
        const wireType = Number(tag & 0x7n);
        if (wireType === 0) {
          const [value, p2] = this.readVarint(buf, pos);
          pos = p2;
          entries.push({ num, wireType, value });
        } else if (wireType === 1) {
          entries.push({ num, wireType, raw: buf.slice(pos, pos + 8) });
          pos += 8;
        } else if (wireType === 2) {
          const [len, p2] = this.readVarint(buf, pos);
          pos = p2;
          entries.push({ num, wireType, raw: buf.slice(pos, pos + Number(len)) });
          pos += Number(len);
        } else if (wireType === 5) {
          entries.push({ num, wireType, raw: buf.slice(pos, pos + 4) });
          pos += 4;
        } else {
          throw new Error("IronCord: tipo de wire protobuf no soportado: " + wireType);
        }
      }
      return entries;
    },
    encodeTag(num, wireType) {
      return this.writeVarint((BigInt(num) << 3n) | BigInt(wireType));
    },
    serializeEntries(entries) {
      const chunks = [];
      for (const e of entries) {
        if (e.wireType === 0) chunks.push(this.concat([this.encodeTag(e.num, 0), this.writeVarint(e.value)]));
        else if (e.wireType === 2)
          chunks.push(this.concat([this.encodeTag(e.num, 2), this.writeVarint(e.raw.length), e.raw]));
        else if (e.wireType === 1) chunks.push(this.concat([this.encodeTag(e.num, 1), e.raw]));
        else if (e.wireType === 5) chunks.push(this.concat([this.encodeTag(e.num, 5), e.raw]));
      }
      return this.concat(chunks);
    },
    lenField(num, bytes) {
      return { num, wireType: 2, raw: bytes };
    },
    varintField(num, value) {
      return { num, wireType: 0, value: BigInt(value) };
    },
    strBytes(str) {
      return new TextEncoder().encode(str);
    },
    strFromBytes(bytes) {
      return new TextDecoder().decode(bytes || new Uint8Array());
    }
  };

  function buildFavoriteGifMessage({ format, src, width, height, order }) {
    return proto.serializeEntries([
      proto.varintField(1, format),
      proto.lenField(2, proto.strBytes(src)),
      proto.varintField(3, Math.max(1, Math.round(width) || 200)),
      proto.varintField(4, Math.max(1, Math.round(height) || 200)),
      proto.varintField(5, order)
    ]);
  }

  function buildMapEntry(key, favoriteGifBytes) {
    return proto.serializeEntries([proto.lenField(1, proto.strBytes(key)), proto.lenField(2, favoriteGifBytes)]);
  }

  function mapEntryKey(entry) {
    try {
      const fields = proto.parseFields(entry.raw);
      return proto.strFromBytes(fields.find((f) => f.num === 1)?.raw);
    } catch (_) {
      return null;
    }
  }

  async function patchNativeFavorites(mutateFn) {
    const token = await IC.api.getToken();

    const getRes = await fetch(SETTINGS_URL, { headers: { Authorization: token } });
    if (!getRes.ok) throw new Error(`GET settings-proto falló (${getRes.status})`);
    const { settings } = await getRes.json();

    const topEntries = proto.parseFields(b64.toBytes(settings));

    const versionsEntry = topEntries.find((e) => e.num === 1);
    let dataVersion = 0n;
    if (versionsEntry) {
      const dv = proto.parseFields(versionsEntry.raw).find((f) => f.num === 3);
      if (dv) dataVersion = dv.value;
    }

    const favGifsEntry = topEntries.find((e) => e.num === 2);
    const favGifsFields = favGifsEntry ? proto.parseFields(favGifsEntry.raw) : [];
    const gifEntries = favGifsFields.filter((e) => e.num === 1);
    const otherFavGifsFields = favGifsFields.filter((e) => e.num !== 1);

    const newGifEntries = mutateFn(gifEntries);

    const newFavGifsRaw = proto.serializeEntries([...newGifEntries, ...otherFavGifsFields]);
    const newTopEntries = topEntries.filter((e) => e.num !== 2).concat([proto.lenField(2, newFavGifsRaw)]);
    newTopEntries.sort((a, b) => a.num - b.num);

    const newSettingsB64 = b64.fromBytes(proto.serializeEntries(newTopEntries));

    const patchRes = await fetch(SETTINGS_URL, {
      method: "PATCH",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ settings: newSettingsB64, required_data_version: Number(dataVersion) })
    });
    if (!patchRes.ok) throw new Error(`PATCH settings-proto falló (${patchRes.status})`);
  }

  async function fetchNativeFavorites() {
    const token = await IC.api.getToken();
    const getRes = await fetch(SETTINGS_URL, { headers: { Authorization: token } });
    if (!getRes.ok) throw new Error(`GET settings-proto falló (${getRes.status})`);
    const { settings } = await getRes.json();

    const topEntries = proto.parseFields(b64.toBytes(settings));
    const favGifsEntry = topEntries.find((e) => e.num === 2);
    const favGifsFields = favGifsEntry ? proto.parseFields(favGifsEntry.raw) : [];
    const gifEntries = favGifsFields.filter((e) => e.num === 1);

    const list = [];
    for (const entry of gifEntries) {
      try {
        const mapFields = proto.parseFields(entry.raw);
        const key = proto.strFromBytes(mapFields.find((f) => f.num === 1)?.raw);
        const valField = mapFields.find((f) => f.num === 2);
        if (!key || !valField) continue;
        const gifFields = proto.parseFields(valField.raw);
        const format = Number(gifFields.find((f) => f.num === 1)?.value ?? 1n);
        const src = proto.strFromBytes(gifFields.find((f) => f.num === 2)?.raw);
        const width = Number(gifFields.find((f) => f.num === 3)?.value ?? 0n);
        const height = Number(gifFields.find((f) => f.num === 4)?.value ?? 0n);
        const order = Number(gifFields.find((f) => f.num === 5)?.value ?? 0n);
        list.push({
          key,
          src,
          width,
          height,
          order,
          type: format === 2 ? "video" : format === 0 ? "text" : "image"
        });
      } catch (_) {}
    }
    list.sort((a, b) => b.order - a.order);
    return list;
  }

  async function addNativeFavorite(key, format, src, width, height) {
    await patchNativeFavorites((gifEntries) => {
      const filtered = gifEntries.filter((e) => mapEntryKey(e) !== key);
      const order = filtered.length;
      const gifBytes = buildFavoriteGifMessage({ format, src, width, height, order });
      const newEntry = proto.lenField(1, buildMapEntry(key, gifBytes));
      return [...filtered, newEntry];
    });
  }

  async function removeNativeFavorite(key) {
    await patchNativeFavorites((gifEntries) => gifEntries.filter((e) => mapEntryKey(e) !== key));
  }

  let nativeFavorites = [];
  let favoritesLoaded = false;

  async function refreshFavorites() {
    try {
      nativeFavorites = await fetchNativeFavorites();
      favoritesLoaded = true;
    } catch (e) {
      console.warn("[IronCord] No se pudo leer tus favoritos de Discord:", e);
    }
    renderGrid(currentFilter);
  }

  async function saveFavorite(url, type, dims = {}) {
    const format = type === "video" ? 2 : type === "text" ? 0 : 1;
    try {
      await addNativeFavorite(url, format, url, dims.width, dims.height);
      IC.ui.toast(type === "text" ? "📝 Texto guardado en tus Favoritos de Discord" : "⭐ Guardado en tus Favoritos de Discord");
      await refreshFavorites();
    } catch (err) {
      console.warn("[IronCord] No se pudo guardar en Discord:", err);
      IC.ui.toast("⚠️ No se pudo guardar en Discord (revisa la consola, F12)");
    }
  }

  async function removeFavorite(key) {
    try {
      await removeNativeFavorite(key);
      IC.ui.toast("🗑️ Eliminado de tus Favoritos de Discord");
      await refreshFavorites();
    } catch (err) {
      console.warn("[IronCord] No se pudo eliminar en Discord:", err);
      IC.ui.toast("⚠️ No se pudo eliminar en Discord");
    }
  }

  function detectType(el) {
    if (el.tagName === "VIDEO") return "video";
    const src = el.currentSrc || el.src || "";
    if (/\.gif(\?.*)?$/i.test(src)) return "gif";
    return "image";
  }

  function getSourceUrl(el) {
    return el.currentSrc || el.src || el.poster || "";
  }

  function hasNativeFavoriteButton(el) {
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      node = node.parentElement;
      if (node && node.querySelector('[class*="gifFavoriteButton"]')) return true;
    }
    return false;
  }

  function isEligibleMedia(el) {
    if (!el || el.closest(".ironcord-panel") || el.closest(".ironcord-fab")) return false;
    if (el.tagName !== "IMG" && el.tagName !== "VIDEO") return false;
    const src = getSourceUrl(el);
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) return false;
    const w = el.naturalWidth || el.videoWidth || el.clientWidth || 0;
    const h = el.naturalHeight || el.videoHeight || el.clientHeight || 0;
    if (w && h && w < 24 && h < 24) return false;
    if (hasNativeFavoriteButton(el)) return false;
    return true;
  }

  function isEligibleTextBlock(el) {
    if (!el || el.closest(".ironcord-panel") || el.closest(".ironcord-fab")) return false;
    if (!el.id || !el.id.startsWith("message-content-")) return false;
    const text = el.textContent?.trim();
    if (!text || text.length < 2) return false;
    return true;
  }

  let starBtn = null;
  let currentTarget = null;
  let hideTimer = null;

  function buildStarButton() {
    const btn = document.createElement("button");
    btn.className = "ironcord-fav-btn-floating";
    btn.title = "Añadir a Favoritos de Discord (IronCord)";
    btn.textContent = "☆";
    btn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    btn.addEventListener("mouseleave", scheduleHide);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentTarget) return;
      const el = currentTarget;
      if (el.dataset.ironcordKind === "text") {
        saveTextAsImageFavorite(el.textContent.trim());
      } else {
        const dims =
          el.tagName === "VIDEO"
            ? { width: el.videoWidth, height: el.videoHeight }
            : { width: el.naturalWidth, height: el.naturalHeight };
        saveFavorite(getSourceUrl(el), detectType(el), dims);
      }
      btn.textContent = "★";
      btn.classList.add("saved");
    });
    document.body.appendChild(btn);
    return btn;
  }

  function positionButtonOver(el) {
    if (!starBtn) starBtn = buildStarButton();
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const isText = el.id?.startsWith("message-content-");
    el.dataset.ironcordKind = isText ? "text" : "media";
    starBtn.style.top = `${rect.top + 2}px`;
    starBtn.style.left = isText ? `${rect.right + 6}px` : `${rect.right - 34}px`;
    starBtn.style.display = "flex";
    const alreadySaved = isText
      ? false
      : nativeFavorites.some((f) => f.src === getSourceUrl(el));
    starBtn.textContent = alreadySaved ? "★" : "☆";
    starBtn.classList.toggle("saved", alreadySaved);
    currentTarget = el;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (starBtn) starBtn.style.display = "none";
      currentTarget = null;
    }, 200);
  }

  function onPointerOver(e) {
    const media = e.target.closest("img, video");
    if (media && isEligibleMedia(media)) {
      clearTimeout(hideTimer);
      positionButtonOver(media);
      return;
    }
    const textBlock = e.target.closest('[id^="message-content-"]');
    if (textBlock && isEligibleTextBlock(textBlock)) {
      clearTimeout(hideTimer);
      positionButtonOver(textBlock);
    }
  }

  function onPointerOut(e) {
    const el = e.target.closest('img, video, [id^="message-content-"]');
    if (!el) return;
    if (e.relatedTarget && starBtn && starBtn.contains(e.relatedTarget)) return;
    scheduleHide();
  }

  function onScrollOrResize() {
    if (currentTarget && starBtn && starBtn.style.display === "flex") {
      positionButtonOver(currentTarget);
    }
  }

  function attachGlobalListeners() {
    document.addEventListener("mouseover", onPointerOver, true);
    document.addEventListener("mouseout", onPointerOut, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
  }

  function detachGlobalListeners() {
    document.removeEventListener("mouseover", onPointerOver, true);
    document.removeEventListener("mouseout", onPointerOut, true);
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
  }

  let currentFilter = "all";

  function buildPanel() {
    const fab = document.createElement("button");
    fab.className = "ironcord-fab";
    fab.title = "Favoritos de Discord (IronCord)";
    fab.textContent = "★";
    fab.addEventListener("click", togglePanel);
    document.body.appendChild(fab);

    const panel = document.createElement("div");
    panel.className = "ironcord-panel";
    panel.innerHTML = `
      <div class="ironcord-panel-header">
        <span>Favoritos</span>
        <button class="ironcord-tab" data-close>✕</button>
      </div>
      <div class="ironcord-panel-tabs">
        <button class="ironcord-tab active" data-filter="all">Todo</button>
        <button class="ironcord-tab" data-filter="image">Imágenes</button>
        <button class="ironcord-tab" data-filter="video">Vídeos</button>
        <button class="ironcord-tab" data-filter="text">Texto</button>
      </div>
      <div class="ironcord-panel-grid"></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector("[data-close]").addEventListener("click", togglePanel);
    panel.querySelectorAll("[data-filter]").forEach((tab) => {
      tab.addEventListener("click", () => {
        panel.querySelectorAll("[data-filter]").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        currentFilter = tab.dataset.filter;
        renderGrid(currentFilter);
      });
    });

    return panel;
  }

  let panelEl = null;

  function togglePanel() {
    if (!panelEl) panelEl = buildPanel();
    panelOpen = !panelOpen;
    panelEl.classList.toggle("open", panelOpen);
    if (panelOpen) refreshFavorites();
  }

  function renderGrid(filter) {
    if (!panelEl) return;
    const grid = panelEl.querySelector(".ironcord-panel-grid");

    if (!favoritesLoaded) {
      grid.innerHTML = `<div class="ironcord-panel-loading">Cargando desde Discord…</div>`;
      return;
    }

    const items = nativeFavorites.filter((f) => filter === "all" || f.type === filter);
    if (items.length === 0) {
      grid.innerHTML = `<div class="ironcord-panel-empty">Aún no tienes favoritos.<br>Pasa el cursor sobre una imagen, gif o vídeo en Discord y pulsa ☆, o selecciona texto y usa el menú contextual.</div>`;
      return;
    }
    grid.innerHTML = "";
    for (const item of items) {
      const el = document.createElement("div");
      if (item.type === "text") {
        el.className = "ironcord-panel-item text-item";
        el.textContent = item.src.length > 80 ? item.src.slice(0, 80) + "…" : item.src;
      } else {
        el.className = "ironcord-panel-item";
        el.innerHTML =
          item.type === "video"
            ? `<video src="${item.src}" muted loop></video>`
            : `<img src="${item.src}" loading="lazy">`;
      }
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.title = "Quitar de favoritos";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFavorite(item.key);
      });
      el.appendChild(del);
      el.addEventListener("click", () => {
        navigator.clipboard?.writeText(item.src).catch(() => {});
        IC.ui.toast(item.type === "text" ? "Texto copiado 📋" : "Enlace copiado 📋");
      });
      grid.appendChild(el);
    }
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function textToImageBlob(text) {
    return new Promise((resolve) => {
      const PADDING = 40;
      const MAX_WIDTH = 560;
      const FONT_SIZE = 26;
      const LINE_HEIGHT = 36;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.font = `${FONT_SIZE}px "gg sans", "Segoe UI", Arial, sans-serif`;
      const lines = wrapCanvasText(ctx, text, MAX_WIDTH).slice(0, 30);

      const width = MAX_WIDTH + PADDING * 2;
      const height = lines.length * LINE_HEIGHT + PADDING * 2 + 26;
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = "#2b2d31";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#5865f2";
      ctx.fillRect(0, 0, 6, height);

      ctx.fillStyle = "#dbdee1";
      ctx.font = `${FONT_SIZE}px "gg sans", "Segoe UI", Arial, sans-serif`;
      ctx.textBaseline = "top";
      lines.forEach((line, i) => {
        ctx.fillText(line, PADDING, PADDING + i * LINE_HEIGHT);
      });

      ctx.fillStyle = "#6d6f78";
      ctx.font = "14px \"gg sans\", Arial, sans-serif";
      ctx.fillText("Guardado con IronCord", PADDING, height - 24);

      canvas.toBlob((blob) => resolve({ blob, width, height }), "image/png");
    });
  }

  let selfDmChannelId = null;
  async function getSelfDmChannelId() {
    if (selfDmChannelId) return selfDmChannelId;
    const me = await IC.api.request("/users/@me");
    const dm = await IC.api.request("/users/@me/channels", {
      method: "POST",
      body: JSON.stringify({ recipients: [me.id] })
    });
    selfDmChannelId = dm.id;
    return selfDmChannelId;
  }

  async function uploadImageToDiscord(blob, filename) {
    const token = await IC.api.getToken();
    const channelId = await getSelfDmChannelId();
    const attachRes = await fetch(`https://discord.com/api/v9/channels/${channelId}/attachments`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ filename, file_size: blob.size, id: "0" }] })
    });
    if (!attachRes.ok) throw new Error(`No se pudo iniciar la subida (${attachRes.status})`);
    const { attachments } = await attachRes.json();
    const { upload_url, upload_filename } = attachments[0];
    const putRes = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
    if (!putRes.ok) throw new Error(`Fallo al subir la imagen (${putRes.status})`);
    const msgRes = await fetch(`https://discord.com/api/v9/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Texto guardado (IronCord)",
        attachments: [{ id: "0", filename, uploaded_filename: upload_filename }]
      })
    });
    if (!msgRes.ok) throw new Error(`No se pudo finalizar el adjunto (${msgRes.status})`);
    const msg = await msgRes.json();
    return msg.attachments?.[0]?.url;
  }

  async function saveTextAsImageFavorite(text) {
    try {
      const { blob, width, height } = await textToImageBlob(text);
      const url = await uploadImageToDiscord(blob, `ironcord-texto-${Date.now()}.png`);
      if (!url) throw new Error("Discord no devolvió una URL de imagen");
      await saveFavorite(url, "image", { width, height });
    } catch (err) {
      console.warn("[IronCord] No se pudo convertir el texto en imagen, se guarda como texto plano:", err);
      IC.ui.toast("⚠️ No se pudo generar la imagen, guardado como texto plano");
      await saveFavorite(text, "text");
    }
  }

  function getMediaDimensions(url, type) {
    return new Promise((resolve) => {
      if (type === "video") {
        const v = document.createElement("video");
        v.onloadedmetadata = () => resolve({ width: v.videoWidth || 200, height: v.videoHeight || 200 });
        v.onerror = () => resolve({ width: 200, height: 200 });
        v.src = url;
      } else {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 200, height: img.naturalHeight || 200 });
        img.onerror = () => resolve({ width: 200, height: 200 });
        img.src = url;
      }
    });
  }

  window.addEventListener("ironcord:favorite-added-contextmenu", (e) => {
    const { url, type } = e.detail;
    if (type === "text") {
      saveTextAsImageFavorite(url);
      return;
    }
    getMediaDimensions(url, type).then(({ width, height }) => saveFavorite(url, type, { width, height }));
  });

  window.addEventListener("ironcord:open-favorites-panel", () => {
    if (!panelOpen) togglePanel();
  });

  IC.registerPlugin({
    id: "favorites",
    name: "Favorite everything",
    start() {
      attachGlobalListeners();
      refreshFavorites();
    },
    stop() {
      detachGlobalListeners();
      clearTimeout(hideTimer);
      starBtn?.remove();
      starBtn = null;
      currentTarget = null;
      document.querySelector(".ironcord-fab")?.remove();
      document.querySelector(".ironcord-panel")?.remove();
      panelEl = null;
      panelOpen = false;
      IC.utils.removeCSS("ironcord-favorites-style");
    }
  });
})();
