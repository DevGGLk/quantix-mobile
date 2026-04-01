import * as FileSystem from 'expo-file-system/legacy';
import { EncodingType } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const b64 = globalThis.btoa?.(binary);
  if (!b64) {
    throw new Error('No se pudo codificar el PDF en este dispositivo.');
  }
  return b64;
}

function portalApiBase(): string {
  const raw = String(process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').trim().replace(/\/$/, '');
  return raw;
}

/**
 * POST al portal web; guarda el PDF en caché y abre el diálogo nativo de compartir / ver.
 */
export async function downloadAndSharePortalPayslipPdf(params: {
  accessToken: string;
  slipId: string;
}): Promise<void> {
  const base = portalApiBase();
  if (!base) {
    throw new Error('Falta EXPO_PUBLIC_QUANTIX_API_URL en la configuración de la app.');
  }

  const url = `${base}/api/portal/payslip-pdf`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/pdf',
    },
    body: JSON.stringify({ slipId: params.slipId }),
  });

  const ct = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    if (ct.includes('application/json')) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(j?.error?.trim() || `Error ${res.status}`);
    }
    const text = await res.text().catch(() => '');
    throw new Error(text?.slice(0, 200) || `Error ${res.status}`);
  }

  const buf = await res.arrayBuffer();
  if (!buf.byteLength) {
    throw new Error('El servidor devolvió un PDF vacío.');
  }

  const base64 = arrayBufferToBase64(buf);
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!dir) {
    throw new Error('No hay carpeta de archivos disponible en este dispositivo.');
  }

  const safeId = params.slipId.replace(/[^\w-]+/g, '_').slice(0, 80);
  const fileUri = `${dir}recibo_nomina_${safeId}.pdf`;

  await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: EncodingType.Base64 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Recibo de nómina',
    });
  } else {
    throw new Error('Compartir archivos no está disponible en este dispositivo.');
  }
}
