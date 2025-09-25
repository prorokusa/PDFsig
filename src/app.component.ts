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
  signatureMode = signal<'draw' | 'upload'>('draw');
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
    if (this.signatureCanvas && this.signatureMode() === 'draw') {
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
    if ((event.target as HTMLElement).closest('.signature-wrapper, .pdf-controls')) return;

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
    this.loadingMessage.set('Обработка подписи...');

    setTimeout(async () => {
        try {
            const canvas = this.croppingCanvas.nativeElement;
            const scaleRatio = this.originalImageForCrop!.width / canvas.width;

            const cropX = Math.min(this.cropStartPos!.x, this.cropEndPos!.x) * scaleRatio;
            const cropY = Math.min(this.cropStartPos!.y, this.cropEndPos!.y) * scaleRatio;
            const cropW = Math.abs(this.cropStartPos!.x - this.cropEndPos!.x) * scaleRatio;
            const cropH = Math.abs(this.cropStartPos!.y - this.cropEndPos!.y) * scaleRatio;

            if (cropW < 10 || cropH < 10) {
                alert('Выделенная область слишком мала. Пожалуйста, выделите большую область.');
                return;
            }
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = cropW;
            tempCanvas.height = cropH;
            const tempCtx = tempCanvas.getContext('2d');
            if (!tempCtx) throw new Error('Could not create temporary canvas context');

            tempCtx.drawImage(this.originalImageForCrop!, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            
            const croppedDataUrl = tempCanvas.toDataURL('image/png');
            
            const cleanedDataUrl = await this._removeBackgroundAlgorithmically(croppedDataUrl);
            
            await this.finalizeSignature(cleanedDataUrl);
            this.cancelCrop();
        } catch(error) {
            console.error("Error processing signature:", error);
            alert(`Не удалось обработать подпись: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.isLoading.set(false);
        }
    }, 10);
  }

  private _removeBackgroundAlgorithmically(base64ImageDataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return reject(new Error('Could not get canvas context for background removal'));
        }
        ctx.drawImage(img, 0, 0);

        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

          const getPixel = (x: number, y: number) => {
            const i = (y * canvas.width + x) * 4;
            return { r: data[i], g: data[i + 1], b: data[i + 2] };
          };
          
          const cornerPixels = [
              getPixel(0, 0),
              getPixel(canvas.width - 1, 0),
              getPixel(0, canvas.height - 1),
              getPixel(canvas.width - 1, canvas.height - 1)
          ];

          const avgBackground = cornerPixels.reduce((acc, p) => ({
              r: acc.r + p.r / cornerPixels.length,
              g: acc.g + p.g / cornerPixels.length,
              b: acc.b + p.b / cornerPixels.length,
          }), { r: 0, g: 0, b: 0 });
          
          const outputImageData = ctx.createImageData(canvas.width, canvas.height);
          const outputData = outputImageData.data;
          
          const colorDistanceThreshold = 80;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            if (a < 128) {
                outputData[i] = 0; outputData[i+1] = 0; outputData[i+2] = 0; outputData[i+3] = 0;
                continue;
            }

            const distance = Math.sqrt(
              Math.pow(r - avgBackground.r, 2) +
              Math.pow(g - avgBackground.g, 2) +
              Math.pow(b - avgBackground.b, 2)
            );

            if (distance > colorDistanceThreshold) {
              // Signature pixel: preserve original color and alpha for smooth edges
              outputData[i] = r;
              outputData[i + 1] = g;
              outputData[i + 2] = b;
              outputData[i + 3] = a;
            } else {
              // Background pixel: make fully transparent
              outputData[i] = 0; outputData[i+1] = 0; outputData[i+2] = 0; outputData[i+3] = 0;
            }
          }
          
          const resultCanvas = document.createElement('canvas');
          resultCanvas.width = canvas.width;
          resultCanvas.height = canvas.height;
          const resultCtx = resultCanvas.getContext('2d');
          if (!resultCtx) return reject(new Error('Could not get final canvas context'));
          
          resultCtx.putImageData(outputImageData, 0, 0);
          resolve(resultCanvas.toDataURL('image/png'));

        } catch (e) {
          console.error('Error during algorithmic background removal:', e);
          resolve(base64ImageDataUrl);
        }
      };
      img.onerror = () => {
          reject(new Error('Failed to load image for background removal'));
      };
      img.src = base64ImageDataUrl;
    });
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