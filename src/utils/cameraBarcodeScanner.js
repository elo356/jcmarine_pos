import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

const NATIVE_BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'codabar'];

const ZXING_BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODABAR
];

export const getCameraAccessErrorMessage = (error) => {
  if (error?.name === 'NotAllowedError') {
    return 'No se concedio permiso a la camara.';
  }

  if (error?.name === 'NotFoundError') {
    return 'No se encontro una camara disponible.';
  }

  if (error?.name === 'NotReadableError') {
    return 'La camara esta siendo usada por otra aplicacion.';
  }

  return 'No se pudo iniciar la camara para escanear.';
};

const buildCameraConstraints = () => ({
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 }
  },
  audio: false
});

const startNativeBarcodeScanner = async ({ videoElement, streamRef, onDetected }) => {
  const BarcodeDetectorCtor = window.BarcodeDetector;
  const supportedFormats = BarcodeDetectorCtor.getSupportedFormats
    ? await BarcodeDetectorCtor.getSupportedFormats()
    : [];
  const formats = supportedFormats.length > 0
    ? NATIVE_BARCODE_FORMATS.filter((format) => supportedFormats.includes(format))
    : NATIVE_BARCODE_FORMATS;
  const detector = new BarcodeDetectorCtor({ formats: formats.length > 0 ? formats : undefined });

  const stream = await navigator.mediaDevices.getUserMedia(buildCameraConstraints());
  streamRef.current = stream;
  videoElement.srcObject = stream;
  await videoElement.play();

  const intervalId = setInterval(async () => {
    if (!videoElement || videoElement.readyState < 2) return;

    try {
      const barcodes = await detector.detect(videoElement);
      const detectedCode = barcodes[0]?.rawValue;
      if (detectedCode) {
        onDetected(detectedCode);
      }
    } catch (error) {
      console.error('Error detecting barcode:', error);
    }
  }, 500);

  return () => {
    clearInterval(intervalId);
    stream.getTracks().forEach((track) => track.stop());
  };
};

const startZxingBarcodeScanner = async ({ videoElement, onDetected }) => {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_BARCODE_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const codeReader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 250,
    delayBetweenScanSuccess: 750,
    tryPlayVideoTimeout: 5000
  });

  const controls = await codeReader.decodeFromConstraints(
    buildCameraConstraints(),
    videoElement,
    (result, error) => {
      if (result) {
        onDetected(result.getText());
        return;
      }

      if (error && error.name !== 'NotFoundException') {
        console.error('Error detecting barcode with ZXing:', error);
      }
    }
  );

  return () => controls.stop();
};

export const startCameraBarcodeScanner = async ({ videoElement, streamRef, onDetected }) => {
  if (!window.isSecureContext) {
    throw new Error('INSECURE_CONTEXT');
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('MEDIA_DEVICES_UNSUPPORTED');
  }

  if (typeof window.BarcodeDetector !== 'undefined') {
    return startNativeBarcodeScanner({ videoElement, streamRef, onDetected });
  }

  return startZxingBarcodeScanner({ videoElement, onDetected });
};
