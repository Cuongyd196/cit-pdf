import { isValidImageFile } from './image-input-utils.js';

export interface PartitionedFiles {
  pdfFiles: File[];
  imageFiles: File[];
  skipped: string[];
}

export function partitionIncomingFiles(rawFiles: File[]): PartitionedFiles {
  const pdfFiles: File[] = [];
  const imageFiles: File[] = [];
  const skipped: string[] = [];

  for (const f of rawFiles) {
    if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
      pdfFiles.push(f);
    } else if (isValidImageFile(f)) {
      imageFiles.push(f);
    } else {
      skipped.push(f.name);
    }
  }

  return { pdfFiles, imageFiles, skipped };
}
