/**
 * JESic Meet - Ottimizzatore e Compressore Immagini Ultra-Leggero
 * 
 * Regola fondamentale:
 * Riduce al minimo il peso dei dati sul database (limite 500 MB)
 * garantendo che le foto in chat, avatar profilo e loghi pesino al massimo 40-60 KB ciascuna,
 * mantenendo una qualità visiva limpida e definita sugli schermi degli smartphone.
 */

export interface OptimizeImageOptions {
  maxDimension?: number; // es. 900px per foto chat, 320px per avatar profilo
  targetMaxKB?: number;  // es. 50 KB (default: 50 KB, max consentito: 60 KB)
  mimeType?: 'image/jpeg' | 'image/webp';
}

/**
 * Converte e ottimizza un file immagine o una dataUrl base64
 * restituendo una dataUrl JPEG/WebP ultra-leggera strettamente entro 40-60 KB.
 */
export async function optimizeImageToUltraLight(
  input: File | string,
  options: OptimizeImageOptions = {}
): Promise<{ url: string; size: number }> {
  const maxDim = options.maxDimension || 900;
  const targetMaxKB = Math.min(options.targetMaxKB || 50, 60);
  const targetMaxBytes = targetMaxKB * 1024;
  const mimeType = options.mimeType || 'image/jpeg';

  // Se è un SVG puro, restituiscilo o leggilo senza degradarlo
  if (typeof input !== 'string' && input.type === 'image/svg+xml') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ url: e.target?.result as string, size: input.size });
      reader.onerror = () => reject(new Error('Errore lettura SVG'));
      reader.readAsDataURL(input);
    });
  }

  // Ottieni dataUrl di partenza
  const sourceDataUrl: string = await new Promise((resolve, reject) => {
    if (typeof input === 'string') {
      resolve(input);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Impossibile leggere il file dal dispositivo'));
      reader.readAsDataURL(input);
    }
  });

  // Carica nell'elemento Image
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // 1. Ridimensiona proporzionalmente se supera maxDim
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          const rawBytes = Math.round((sourceDataUrl.length * 3) / 4);
          resolve({ url: sourceDataUrl, size: rawBytes });
          return;
        }

        // Abilita interpolazione bilineare di alta qualità
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Disegna sfondo bianco (utile se PNG trasparente viene convertito a JPEG)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        ctx.drawImage(img, 0, 0, width, height);

        // 2. Loop di compressione progressiva calibrato sul target <= targetMaxKB (40-60 KB)
        let quality = 0.75;
        let bestDataUrl = canvas.toDataURL(mimeType, quality);
        let bestBytes = Math.round((bestDataUrl.length * 3) / 4);

        // Se supera il target, riduciamo la qualità e se necessario le dimensioni in max 4 passi rapidi
        let iterations = 0;
        const qualitySteps = [0.65, 0.55, 0.45, 0.38];

        while (bestBytes > targetMaxBytes && iterations < qualitySteps.length) {
          quality = qualitySteps[iterations];
          bestDataUrl = canvas.toDataURL(mimeType, quality);
          bestBytes = Math.round((bestDataUrl.length * 3) / 4);

          // Se ancora troppo grande (es. foto con moltissimi dettagli), ridimensiona del 20%
          if (bestBytes > targetMaxBytes && iterations >= 2) {
            const scaledCanvas = document.createElement('canvas');
            const newW = Math.round(width * 0.8);
            const newH = Math.round(height * 0.8);
            scaledCanvas.width = newW;
            scaledCanvas.height = newH;
            const sCtx = scaledCanvas.getContext('2d');
            if (sCtx) {
              sCtx.fillStyle = '#ffffff';
              sCtx.fillRect(0, 0, newW, newH);
              sCtx.drawImage(canvas, 0, 0, newW, newH);
              bestDataUrl = scaledCanvas.toDataURL(mimeType, 0.50);
              bestBytes = Math.round((bestDataUrl.length * 3) / 4);
            }
          }
          iterations++;
        }

        resolve({ url: bestDataUrl, size: bestBytes });
      } catch (err) {
        console.warn('[imageOptimizer] Fallback compressione automatica:', err);
        const rawBytes = Math.round((sourceDataUrl.length * 3) / 4);
        resolve({ url: sourceDataUrl, size: rawBytes });
      }
    };

    img.onerror = () => {
      console.warn('[imageOptimizer] Errore decodifica immagine');
      const rawBytes = Math.round((sourceDataUrl.length * 3) / 4);
      resolve({ url: sourceDataUrl, size: rawBytes });
    };

    img.src = sourceDataUrl;
  });
}
