import {
  Component,
  ChangeDetectionStrategy,
  signal,
  ViewChild,
  ElementRef,
  effect,
} from '@angular/core';

// External libraries are loaded via script tags in index.html and accessed via the `window` object.

interface Position {
  x: number;
  y: number;
}

interface PlacedSignature {
  id: number;
  position: Position;
  page: number;
  width: number;
  height: number;
  aspectRatio: number;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:mousemove)': 'onDrag($event)',
    '(window:touchmove)': 'onDrag($event)',
    '(window:mouseup)': 'onEndInteraction($event)',
    '(window:touchend)': 'onEndInteraction($event)',
  },
})
export class AppComponent {
  @ViewChild('pdfCanvas') pdfCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('signatureCanvas') signatureCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('croppingCanvas') croppingCanvas!: ElementRef<HTMLCanvasElement>;

  // --- Signals for State Management ---
  fileName = signal<string>('');
  pdfFile = signal<File | null>(null);
  pdfDoc = signal<any>(null); // Holds the loaded PDF document object
  pdfPage = signal<any>(null); // Holds the current PDF page object
  currentPage = signal<number>(1);
  totalPages = signal<number>(0);

  signaturePad: any = null;
  signatureDataUrl = signal<string | null>(null);
  trimmedSignatureSize = signal<{ width: number; height: number; aspectRatio: number } | null>(null);
  placedSignatures = signal<PlacedSignature[]>([]);

  isSigning = signal<boolean>(false);
  isCropping = signal<boolean>(false);
  croppingImageUrl = signal<string | null>(null);
  isHelpVisible = signal<boolean>(false);
  isPlacingSignature = signal<boolean>(false);
  
  // --- Signature Settings Signals ---
  penColor = signal<string>('rgb(79, 70, 229)'); // Default Indigo
  penThickness = signal<number>(1.0); // Default thickness
  
  availablePenColors = [
    'rgb(79, 70, 229)',  // Indigo
    'rgb(15, 23, 42)',   // Slate-900 (Black)
    'rgb(220, 38, 38)',  // Red-600
    'rgb(5, 150, 105)'   // Emerald-600
  ];

  isLoading = signal<boolean>(false);
  loadingMessage = signal<string>('');
  
  // --- Interaction State ---
  draggedSignature = signal<{ signature: PlacedSignature; startPos: Position; eventStartPos: Position } | null>(null);
  resizingSignature = signal<{ signature: PlacedSignature; startSize: {width: number, height: number}; eventStartPos: Position } | null>(null);
  private interactionOccurred = false;

  // --- Cropping State ---
  private cropStartPos: Position | null = null;
  private cropEndPos: Position | null = null;
  private isDrawingCrop = false;
  private originalImageForCrop: HTMLImageElement | null = null;
  
  // --- PDF.js Configuration ---
  private static pdfJsInitPromise: Promise<void> | null = null;
  private readonly pdfRenderScale = 1.5;

  constructor() {
    effect(() => {
      const pdf = this.pdfFile();
      if (pdf) {
        this.loadPdf(pdf);
      }
    });

    effect(() => {
      if (this.isCropping() && this.croppingImageUrl()) {
        setTimeout(() => this.initCroppingCanvas(), 0);
      }
    });

    // Effect to update signature pad settings in real-time
    effect(() => {
        if (this.signaturePad) {
            this.signaturePad.penColor = this.penColor();
            this.signaturePad.maxWidth = this.penThickness();
        }
    });

    effect(() => {
      // Re-render the PDF page whenever the current page number changes
      const pageNum = this.currentPage();
      const doc = this.pdfDoc();
      if (pageNum && doc) {
        this.renderCurrentPage();
      }
    });
  }

  private initializePdfJs(): Promise<void> {
    if (AppComponent.pdfJsInitPromise) {
      return AppComponent.pdfJsInitPromise;
    }
    AppComponent.pdfJsInitPromise = new Promise((resolve, reject) => {
      const checkLibrary = () => {
        const pdfjsLib = (window as any).pdfjsLib;
        if (pdfjsLib) {
          try {
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
            resolve();
          } catch (e) {
             console.error('Error setting up pdf.js worker', e);
             reject(e);
          }
        } else {
          setTimeout(checkLibrary, 100); // Check every 100ms
        }
      };
      checkLibrary();
    });
    return AppComponent.pdfJsInitPromise;
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    if (file.type !== 'application/pdf') {
      alert('Пожалуйста, выберите PDF файл.');
      return;
    }
    this.resetApp();
    this.pdfFile.set(file);
    this.fileName.set(file.name);
  }
  
  private async loadPdf(file: File) {
    this.isLoading.set(true);
    this.loadingMessage.set('Загрузка PDF...');
    try {
      await this.initializePdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await (window as any).pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      this.pdfDoc.set(pdf);
      this.totalPages.set(pdf.numPages);
      this.currentPage.set(1); // Triggers effect to render page 1
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Не удалось загрузить PDF файл.');
      this.resetApp();
    } finally {
      this.isLoading.set(false);
    }
  }

  async renderCurrentPage() {
    if (!this.pdfDoc() || !this.pdfCanvas) return;
    this.isLoading.set(true);
    this.loadingMessage.set(`Отрисовка страницы ${this.currentPage()}...`);
    try {
      const page = await this.pdfDoc().getPage(this.currentPage());
      this.pdfPage.set(page);
      const viewport = page.getViewport({ scale: this.pdfRenderScale });
      const canvas = this.pdfCanvas.nativeElement;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Failed to get 2D context from canvas.');
      }
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };
      await page.render(renderContext).promise;
    } catch (error) {
      console.error('Error rendering PDF:', error);
      alert(`Не удалось отобразить страницу ${this.currentPage()}.`);
    } finally {
      this.isLoading.set(false);
    }
  }

  goToPreviousPage() {
    if (this.currentPage() > 1) {
      this.currentPage.update(p => p - 1);
    }
  }

  goToNextPage() {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update(p => p + 1);
    }
  }

  openSignatureModal() {
    this.isSigning.set(true);
    setTimeout(() => this.initSignaturePad(), 0);
  }
  
  closeSignatureModal() {
    this.isSigning.set(false);
    this.signaturePad = null;
  }

  initSignaturePad() {
    if (this.signatureCanvas) {
        const canvas = this.signatureCanvas.nativeElement;
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext('2d')?.scale(ratio, ratio);
        this.signaturePad = new (window as any).SignaturePad(canvas, {
          penColor: this.penColor(),
          minWidth: 0.25,
          maxWidth: this.penThickness(),
        });
    }
  }

  clearSignature() {
    this.signaturePad?.clear();
  }

  async saveSignature() {
    if (!this.signaturePad || this.signaturePad.isEmpty()) {
      alert('Пожалуйста, сначала поставьте подпись.');
      return;
    }
    const dataUrl = this.signaturePad.toDataURL('image/png');
    this.isLoading.set(true);
    this.loadingMessage.set('Обработка подписи...');
    try {
      await this.finalizeSignature(dataUrl);
      this.closeSignatureModal();
    } catch (error) {
      console.error("Error saving signature:", error);
      alert("Не удалось сохранить подпись.");
    } finally {
      this.isLoading.set(false);
    }
  }

  async onSignatureImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = (e: ProgressEvent<FileReader>) => {
      if (typeof e.target?.result !== 'string') {
        alert('Не удалось прочитать файл изображения.');
        return;
      }
      this.croppingImageUrl.set(e.target.result);
      this.isSigning.set(false);
      this.isCropping.set(true);
      input.value = '';
    };

    reader.onerror = () => {
      alert('Ошибка при чтении файла.');
      input.value = '';
    };

    reader.readAsDataURL(file);
  }

  private processSignatureImage(
    dataUrl: string
  ): Promise<{ dataUrl: string; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return reject(new Error('Could not get context for processing'));
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;

        let minX = tempCanvas.width, minY = tempCanvas.height, maxX = -1, maxY = -1;
        for (let y = 0; y < tempCanvas.height; y++) {
          for (let x = 0; x < tempCanvas.width; x++) {
            if (data[(y * tempCanvas.width + x) * 4 + 3] > 0) {
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
        }
        if (maxX === -1) {
          resolve({ dataUrl: '', width: 0, height: 0 });
          return;
        }

        const trimmedWidth = maxX - minX + 1;
        const trimmedHeight = maxY - minY + 1;
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = trimmedWidth;
        finalCanvas.height = trimmedHeight;
        const finalCtx = finalCanvas.getContext('2d');
        if (!finalCtx) return reject(new Error('Could not get final context'));
        
        finalCtx.drawImage(tempCanvas, minX, minY, trimmedWidth, trimmedHeight, 0, 0, trimmedWidth, trimmedHeight);
        
        resolve({
          dataUrl: finalCanvas.toDataURL('image/png'),
          width: trimmedWidth,
          height: trimmedHeight,
        });
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  private async finalizeSignature(dataUrl: string) {
      const processed = await this.processSignatureImage(dataUrl);
      if (processed.width === 0) {
        throw new Error('Не удалось обработать изображение. Возможно, оно полностью прозрачно.');
      }

      const newAspectRatio = processed.width / processed.height;

      this.signatureDataUrl.set(processed.dataUrl);
      this.trimmedSignatureSize.set({ 
        width: processed.width, 
        height: processed.height,
        aspectRatio: newAspectRatio
      });
      
      this.isPlacingSignature.set(true);

      this.placedSignatures.update(sigs => 
        sigs.map(s => ({
          ...s,
          aspectRatio: newAspectRatio,
          height: s.width / newAspectRatio
        }))
      );
  }

  placeSignatureOnClick(event: MouseEvent) {
    if (this.interactionOccurred) return;
    if ((event.target as HTMLElement).closest('.signature-wrapper')) return;

    if (this.isPlacingSignature() && this.signatureDataUrl() && this.trimmedSignatureSize()) {
      const sizeInfo = this.trimmedSignatureSize()!;
      
      const canvasElement = this.pdfCanvas.nativeElement;
      const defaultWidth = canvasElement.offsetWidth * 0.15;
      const defaultHeight = defaultWidth / sizeInfo.aspectRatio;

      const viewer = event.currentTarget as HTMLElement;
      const rect = viewer.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const finalX = x + viewer.scrollLeft;
      const finalY = y + viewer.scrollTop;

      const newSignature: PlacedSignature = {
        id: Date.now(),
        page: this.currentPage(),
        position: { x: finalX - defaultWidth / 2, y: finalY - defaultHeight / 2 },
        width: defaultWidth,
        height: defaultHeight,
        aspectRatio: sizeInfo.aspectRatio,
      };
      this.placedSignatures.update(sigs => [...sigs, newSignature]);
    }
  }

  deleteSignature(idToDelete: number, event: MouseEvent) {
    event.stopPropagation();
    this.placedSignatures.update(sigs => sigs.filter(s => s.id !== idToDelete));
  }

  async applyAndDownload() {
    if (!this.pdfFile() || !this.signatureDataUrl() || this.placedSignatures().length === 0) {
        alert("Пожалуйста, создайте и разместите хотя бы одну подпись перед скачиванием.");
        return;
    }
    this.isLoading.set(true);
    this.loadingMessage.set('Применение подписей...');
    try {
        const { PDFDocument } = (window as any).PDFLib;
        const existingPdfBytes = await this.pdfFile()!.arrayBuffer();
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        const pngImageBytes = await fetch(this.signatureDataUrl()!).then(res => res.arrayBuffer());
        const pngImage = await pdfDoc.embedPng(pngImageBytes);

        const signaturesByPage = new Map<number, PlacedSignature[]>();
        this.placedSignatures().forEach(sig => {
            if (!signaturesByPage.has(sig.page)) signaturesByPage.set(sig.page, []);
            signaturesByPage.get(sig.page)!.push(sig);
        });
        
        const canvas = this.pdfCanvas.nativeElement;

        for (const [pageNum, signatures] of signaturesByPage.entries()) {
            const pageToSign = pdfDoc.getPages()[pageNum - 1];
            const pdfJsPage = await this.pdfDoc().getPage(pageNum);
            const viewport = pdfJsPage.getViewport({ scale: this.pdfRenderScale });

            const scaleFactor = viewport.width / canvas.offsetWidth;
            const { height: pageHeightInPoints } = pageToSign.getSize();

            for (const sig of signatures) {
                const canvasX = sig.position.x * scaleFactor;
                const canvasY = sig.position.y * scaleFactor;
                const canvasWidth = sig.width * scaleFactor;
                const canvasHeight = sig.height * scaleFactor;

                const pointX = canvasX / this.pdfRenderScale;
                const pointWidth = canvasWidth / this.pdfRenderScale;
                const pointHeight = canvasHeight / this.pdfRenderScale;
                const pointY = pageHeightInPoints - (canvasY / this.pdfRenderScale) - pointHeight;

                pageToSign.drawImage(pngImage, {
                    x: pointX,
                    y: pointY,
                    width: pointWidth,
                    height: pointHeight,
                });
            }
        }
        
        const pdfBytes = await pdfDoc.save();
        const originalName = this.fileName();
        const dotIndex = originalName.lastIndexOf('.');
        const newFileName = dotIndex !== -1
            ? `${originalName.substring(0, dotIndex)}_подписан${originalName.substring(dotIndex)}`
            : `${originalName}_подписан`;

        this.download(pdfBytes, newFileName, 'application/pdf');
    } catch (error) {
        console.error("Error applying signature:", error);
        alert("Не удалось применить подпись к PDF.");
    } finally {
        this.isLoading.set(false);
    }
  }
  
  download(data: Uint8Array, filename: string, type: string) {
      const blob = new Blob([data], { type });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
  }

  // --- Drag and Resize ---
  private getClientCoords(event: MouseEvent | TouchEvent): Position {
    if ('touches' in event) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    return { x: event.clientX, y: event.clientY };
  }

  dragStart(event: MouseEvent | TouchEvent, signature: PlacedSignature) {
    this.interactionOccurred = true;
    event.preventDefault();
    event.stopPropagation();
    const eventPos = this.getClientCoords(event);
    this.draggedSignature.set({ signature, startPos: { ...signature.position }, eventStartPos: eventPos });
  }

  resizeStart(event: MouseEvent | TouchEvent, signature: PlacedSignature) {
    this.interactionOccurred = true;
    event.preventDefault();
    event.stopPropagation();
    const eventPos = this.getClientCoords(event);
    this.resizingSignature.set({ signature, startSize: { width: signature.width, height: signature.height }, eventStartPos: eventPos });
  }

  onDrag(event: MouseEvent | TouchEvent) {
    const eventPos = this.getClientCoords(event);
    
    const currentDrag = this.draggedSignature();
    if (currentDrag) {
      const dx = eventPos.x - currentDrag.eventStartPos.x;
      const dy = eventPos.y - currentDrag.eventStartPos.y;
      this.placedSignatures.update(signatures => 
        signatures.map(s => 
          s.id === currentDrag.signature.id 
            ? { ...s, position: { x: currentDrag.startPos.x + dx, y: currentDrag.startPos.y + dy } }
            : s
        )
      );
      return;
    }

    const currentResize = this.resizingSignature();
    if (currentResize) {
      const dx = eventPos.x - currentResize.eventStartPos.x;
      const newWidth = Math.max(20, currentResize.startSize.width + dx);
      const newHeight = newWidth / currentResize.signature.aspectRatio;
      this.placedSignatures.update(signatures =>
        signatures.map(s =>
          s.id === currentResize.signature.id
            ? { ...s, width: newWidth, height: newHeight }
            : s
        )
      );
    }
  }

  onEndInteraction(event: MouseEvent | TouchEvent) {
    this.draggedSignature.set(null);
    this.resizingSignature.set(null);
    setTimeout(() => { this.interactionOccurred = false; }, 0);
  }
  
  // --- Signature Settings Methods ---
  setPenColor(color: string) {
    this.penColor.set(color);
  }

  setPenThickness(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.penThickness.set(parseFloat(value));
  }

  // --- Cropping Logic ---
  initCroppingCanvas() {
    if (!this.croppingCanvas) return;
    const img = new Image();
    img.onload = () => {
        this.originalImageForCrop = img;
        const canvas = this.croppingCanvas.nativeElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const container = canvas.parentElement!;
        const canvasWidth = container.offsetWidth;
        const canvasHeight = container.offsetHeight;

        const hRatio = canvasWidth / img.width;
        const vRatio = canvasHeight / img.height;
        const ratio = Math.min(hRatio, vRatio);

        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = this.croppingImageUrl()!;
  }

  private getCanvasRelativeCoords(canvasEl: HTMLCanvasElement, event: MouseEvent | TouchEvent): Position {
      const rect = canvasEl.getBoundingClientRect();
      const clientPos = this.getClientCoords(event);
      return {
          x: clientPos.x - rect.left,
          y: clientPos.y - rect.top,
      };
  }
  
  onCropMouseDown(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    this.isDrawingCrop = true;
    this.cropStartPos = this.getCanvasRelativeCoords(this.croppingCanvas.nativeElement, event);
    this.cropEndPos = this.cropStartPos;
  }
  
  onCropMouseMove(event: MouseEvent | TouchEvent) {
    if (!this.isDrawingCrop) return;
    event.preventDefault();
    this.cropEndPos = this.getCanvasRelativeCoords(this.croppingCanvas.nativeElement, event);
    this.redrawCroppingCanvas();
  }

  onCropMouseUp(event: MouseEvent | TouchEvent) {
    if (!this.isDrawingCrop) return;
    event.preventDefault();
    this.isDrawingCrop = false;
    this.redrawCroppingCanvas();
  }

  redrawCroppingCanvas() {
      if (!this.croppingCanvas || !this.originalImageForCrop) return;
      const canvas = this.croppingCanvas.nativeElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(this.originalImageForCrop, 0, 0, canvas.width, canvas.height);

      if (this.cropStartPos && this.cropEndPos) {
          ctx.fillStyle = 'rgba(0, 100, 255, 0.3)';
          ctx.strokeStyle = 'rgba(0, 100, 255, 0.8)';
          ctx.lineWidth = 2;
          const rectX = Math.min(this.cropStartPos.x, this.cropEndPos.x);
          const rectY = Math.min(this.cropStartPos.y, this.cropEndPos.y);
          const rectW = Math.abs(this.cropStartPos.x - this.cropEndPos.x);
          const rectH = Math.abs(this.cropStartPos.y - this.cropEndPos.y);
          ctx.fillRect(rectX, rectY, rectW, rectH);
          ctx.strokeRect(rectX, rectY, rectW, rectH);
      }
  }

  cancelCrop() {
    this.isCropping.set(false);
    this.croppingImageUrl.set(null);
    this.cropStartPos = null;
    this.cropEndPos = null;
    this.originalImageForCrop = null;
    this.isDrawingCrop = false;
  }

  async applyCropAndSave() {
    if (!this.cropStartPos || !this.cropEndPos || !this.originalImageForCrop) {
        alert('Пожалуйста, выделите область с подписью.');
        return;
    }
    this.isLoading.set(true);
    this.loadingMessage.set('Автоматическая обработка...');

    setTimeout(async () => {
        try {
            const canvas = this.croppingCanvas.nativeElement;
            const scaleRatio = this.originalImageForCrop!.width / canvas.width;

            const cropX = Math.min(this.cropStartPos!.x, this.cropEndPos!.x) * scaleRatio;
            const cropY = Math.min(this.cropStartPos!.y, this.cropEndPos!.y) * scaleRatio;
            const cropW = Math.abs(this.cropStartPos!.x - this.cropEndPos!.x) * scaleRatio;
            const cropH = Math.abs(this.cropStartPos!.y - this.cropEndPos!.y) * scaleRatio;

            if (cropW < 1 || cropH < 1) throw new Error('Выделенная область слишком мала.');
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = cropW;
            tempCanvas.height = cropH;
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            if (!tempCtx) throw new Error('Could not create temporary canvas context');

            tempCtx.drawImage(this.originalImageForCrop!, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            
            const imageData = tempCtx.getImageData(0, 0, cropW, cropH);
            const cleanedImageData = this._removeBackgroundAutomatically(imageData);
            
            tempCtx.putImageData(cleanedImageData, 0, 0);

            const cleanedDataUrl = tempCanvas.toDataURL('image/png');
            
            await this.finalizeSignature(cleanedDataUrl);
            this.cancelCrop();
        } catch(error) {
            console.error("Error processing signature automatically:", error);
            alert(`Не удалось обработать подпись: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.isLoading.set(false);
        }
    }, 10);
  }

  private _colorDistance(c1: [number, number, number], c2: [number, number, number]): number {
    const dr = c1[0] - c2[0];
    const dg = c1[1] - c2[1];
    const db = c1[2] - c2[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  private _removeBackgroundAutomatically(imageData: ImageData): ImageData {
    const { data, width, height } = imageData;
    if (width === 0 || height === 0) {
      return new ImageData(new Uint8ClampedArray(0), 0, 0);
    }

    // --- STEP 1: Find the most dominant color, which we assume is the background paper. ---
    const colorCounts = new Map<string, number>();
    for (let i = 0; i < data.length; i += 8) { // Sample pixels for performance
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        if (a > 200) { // Only consider opaque pixels
            const key = `${r},${g},${b}`;
            colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
        }
    }
    let backgroundColor: [number, number, number] = [255, 255, 255]; // Default to white
    if (colorCounts.size > 0) {
        const mostFrequent = [...colorCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        backgroundColor = mostFrequent.split(',').map(Number) as [number, number, number];
    }
    
    // --- STEP 2: Find a "seed" point for the signature ink color. ---
    // We spiral out from the center to find the first pixel that is significantly
    // different from the background. This is our best guess for the signature's color.
    let signatureInkColor: [number, number, number] | null = null;
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);

    for (let r = 0; r < Math.max(centerX, centerY); r++) {
        // Iterate over a circular path for the given radius
        const numPoints = r === 0 ? 1 : Math.ceil(2 * Math.PI * r);
        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * 2 * Math.PI;
            const x = Math.floor(centerX + r * Math.cos(angle));
            const y = Math.floor(centerY + r * Math.sin(angle));

            if (x >= 0 && x < width && y >= 0 && y < height) {
                const idx = (y * width + x) * 4;
                const a = data[idx+3];
                if (a > 128) { // Make sure the pixel is visible
                    const currentColor: [number, number, number] = [data[idx], data[idx+1], data[idx+2]];
                    if (this._colorDistance(currentColor, backgroundColor) > 40) { // Must be different enough from paper
                        signatureInkColor = currentColor;
                        break;
                    }
                }
            }
        }
        if (signatureInkColor) break;
    }

    // If no ink color is found (e.g., blank image), return a transparent image.
    if (!signatureInkColor) {
        console.warn("Could not find signature ink color.");
        return new ImageData(new Uint8ClampedArray(data.length), width, height);
    }

    // --- STEP 3: The Revolutionary Part - Chroma Keying ---
    // We create a new image. A pixel is kept only if its color is very similar
    // to the signature ink color we found. Everything else becomes transparent.
    const newData = new Uint8ClampedArray(data.length);
    const colorThreshold = 90; // This is the crucial tuning parameter. Higher = more permissive.
    
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        
        if (a < 100) continue; 

        const currentPixelColor: [number, number, number] = [r, g, b];
        const distToInk = this._colorDistance(currentPixelColor, signatureInkColor);
        
        // This is the core logic: if the pixel's color is close to the ink color, we keep it.
        // This effectively ignores other elements like black text, which will have a high color distance.
        if (distToInk < colorThreshold) {
             const alphaFactor = Math.max(0, 1 - (distToInk / colorThreshold));
             newData[i] = r;
             newData[i+1] = g;
             newData[i+2] = b;
             // We square the alpha factor to make the edges fade more sharply, which looks cleaner.
             newData[i+3] = a * (alphaFactor * alphaFactor);
        }
        // By default, pixels in newData are transparent (alpha=0), so we don't need an else case.
    }
    
    return new ImageData(newData, width, height);
  }

  // --- Help Modal Methods ---
  openHelpModal() {
    this.isHelpVisible.set(true);
  }

  closeHelpModal() {
    this.isHelpVisible.set(false);
  }

  // --- App State Methods ---
  resetApp() {
    this.pdfFile.set(null);
    this.fileName.set('');
    this.pdfDoc.set(null);
    this.pdfPage.set(null);
    this.currentPage.set(1);
    this.totalPages.set(0);
    this.signatureDataUrl.set(null);
    this.placedSignatures.set([]);
    this.trimmedSignatureSize.set(null);
    this.isPlacingSignature.set(false);
  }

  togglePlacementMode() {
    if (this.signatureDataUrl()) {
      this.isPlacingSignature.update(v => !v);
    }
  }
}
