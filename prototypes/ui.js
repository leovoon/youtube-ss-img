export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function fileToItem(file, i = 0) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${i}`,
    file,
    name: file.name || `frame-${i + 1}`,
    type: i === 0 ? "keyframe" : "subtitle",
    previewUrl: URL.createObjectURL(file),
  };
}

export function filesToItems(fileList, existingCount = 0) {
  return [...fileList]
    .filter((f) => f.type.startsWith("image/"))
    .map((f, i) => fileToItem(f, existingCount + i));
}

export function renderDropzone(dropEl, onFiles) {
  dropEl.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    dropEl.classList.add("is-dragover");
  });
  dropEl.addEventListener("dragleave", () => dropEl.classList.remove("is-dragover"));
  dropEl.addEventListener("drop", (ev) => {
    ev.preventDefault();
    dropEl.classList.remove("is-dragover");
    onFiles(ev.dataTransfer.files);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function blobToObjectURL(blob) {
  const url = URL.createObjectURL(blob);
  return url;
}

export function moveItem(arr, from, to) {
  const copy = [...arr];
  const [it] = copy.splice(from, 1);
  copy.splice(to, 0, it);
  return copy;
}

export function cardHTML(item, index, opts = {}) {
  const badge = item.type === "keyframe" ? "Keyframe" : "Subtitle band";
  return `
    <article class="frame-card" draggable="true" data-id="${item.id}" data-index="${index}">
      <img src="${item.previewUrl}" alt="${item.name}">
      <div class="frame-card__meta">
        <strong>${String(index + 1).padStart(2, "0")}</strong>
        <span>${item.name}</span>
      </div>
      <div class="frame-card__actions">
        <button data-action="toggle">${badge}</button>
        <button data-action="up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button data-action="down">↓</button>
        <button data-action="remove">×</button>
      </div>
    </article>
  `;
}

export function renderFrameList(root, items, onChange) {
  root.innerHTML = items.map(cardHTML).join("") || `<p class="empty">Drop or select screenshots to start.</p>`;

  root.onclick = (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const card = ev.target.closest(".frame-card");
    const idx = Number(card.dataset.index);
    const action = btn.dataset.action;
    let next = [...items];
    if (action === "toggle") {
      next[idx] = { ...next[idx], type: next[idx].type === "keyframe" ? "subtitle" : "keyframe" };
    } else if (action === "remove") {
      next.splice(idx, 1);
    } else if (action === "up" && idx > 0) {
      next = moveItem(next, idx, idx - 1);
    } else if (action === "down" && idx < next.length - 1) {
      next = moveItem(next, idx, idx + 1);
    }
    onChange(next);
  };

  let dragFrom = null;
  root.ondragstart = (ev) => {
    const card = ev.target.closest(".frame-card");
    if (!card) return;
    dragFrom = Number(card.dataset.index);
    ev.dataTransfer.effectAllowed = "move";
  };
  root.ondragover = (ev) => {
    if (ev.target.closest(".frame-card")) ev.preventDefault();
  };
  root.ondrop = (ev) => {
    ev.preventDefault();
    const card = ev.target.closest(".frame-card");
    if (!card || dragFrom == null) return;
    const to = Number(card.dataset.index);
    onChange(moveItem(items, dragFrom, to));
    dragFrom = null;
  };
}
