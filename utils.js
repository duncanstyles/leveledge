// utils.js

export function showToast(text) {
    const el = document.getElementById('toast-notification');
    if(el) { 
        el.innerText = text; 
        try { el.showPopover(); } catch(e) {}
        el.classList.add('show'); 
        setTimeout(() => { 
            el.classList.remove('show'); 
            setTimeout(() => { try { el.hidePopover(); } catch(e) {} }, 300);
        }, 3500); 
    }
}

export function formatOffset(val) { 
    if (val === null || val === undefined || isNaN(val)) return "--"; 
    return (val >= 0 ? "+" : "") + Math.round(val) + "cm"; 
}

export function buildCastRowHTML(c, castIndex, swingIndex, isCloud = false) {
    let f2t = c.planeTwist !== undefined ? c.planeTwist : c.faceAngle; 
    let pathDeg = (c.pathAngleRads || 0) * (180 / Math.PI);
    let f2p = f2t - pathDeg; 
    
    let rF2t = Math.round(f2t || 0);
    let rF2p = Math.round(f2p || 0);
    let f2tStr = `${rF2t > 0 ? '+' : ''}${rF2t}°`;
    let f2pStr = `${rF2p > 0 ? '+' : ''}${rF2p}°`;

    let speedStr = `Vel: ${(c.passSpeed || 0).toFixed(1)}m/s`;
    
    let starDisplay = c.stars !== "" ? `<span style="color: ${c.starColor};" class="font-bold">${c.stars}</span>` : `<span class="text-muted">-</span>`;
    let prefix = c.isStrike ? "STRIKE" : (castIndex + 1);
    let weightClass = c.isStrike ? "font-bold" : ""; 
    let colClass = c.isStrike ? "" : "text-muted";
    
    let devMm = Math.round((c.dev || 0) * 10);
    let devDisplay = `${c.dir || 'C'} ${devMm}mm`;
    
    let distStr = c.estDist ? `Est: ${Math.round(c.estDist)}m` : `Est: 0m`;
    
    // formatOffset is already in utils.js, so we can call it directly
    let pDeltaStr = `PΔ: ${formatOffset(c.pDelta)}`;
    let traceAccStr = c.isWhiff ? `-` : `Acc: ${(c.estAccRange >= 35 ? 'Max' : Math.round(c.estAccRange) + 'm')}`;
    
    let hitStyle = c.isHit ? `background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-left: 3px solid var(--success); border-radius: 4px;` : `border: 1px solid transparent;`;
    
    let btnClass = isCloud ? 'highlight-cloud-pass-btn' : 'highlight-pass-btn';

    return `
    <div class="cast-row flex-col ${btnClass} ${colClass} ${weightClass}" data-swing-index="${swingIndex}" data-cast-index="${castIndex}" style="${hitStyle} font-size: 0.85rem; padding: 8px; margin-bottom: 4px; cursor: pointer; transition: background 0.2s;">
        
        <!-- SUMMARY ROW (Always Visible) -->
        <div class="flex justify-between items-center">
            <span style="flex: 1; text-align: left;">${prefix}: ${distStr}</span>
            <span style="flex: 1; text-align: center;">${traceAccStr}</span>
            <span style="flex: 1; text-align: right; display: flex; justify-content: flex-end; align-items: center; gap: 6px;">
                ${pDeltaStr}
                <span class="expand-icon text-muted" style="font-size: 0.6rem; margin-top: 2px;">▼</span>
            </span>
        </div>
        
        <!-- DETAILS ROW (Hidden Accordion) -->
        <div class="cast-details flex-col mt-2 pt-2" style="display: none; border-top: 1px dashed var(--border-color);">
            <div class="flex justify-between items-center text-muted font-normal mt-1">
                <span style="flex: 1; text-align: left;">Dev: ${devDisplay}</span>
                <span style="flex: 1; text-align: center;">Tgt: ${f2tStr}</span>
                <span style="flex: 1; text-align: right;">Pth: ${f2pStr}</span>
            </div>
            <div class="flex justify-between items-center text-muted font-normal mt-1">
                <span style="flex: 1; text-align: left;">${speedStr}</span>
                <span style="flex: 1; text-align: center;"></span>
                <span style="flex: 1; text-align: right;">${starDisplay}</span>
            </div>
        </div>
        
    </div>`;
}