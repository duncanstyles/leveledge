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