import { ApiError } from './http';
export async function validatePdf(bytes:Uint8Array) {
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({data:new Uint8Array(bytes),disableFontFace:true,stopAtErrors:true,verbosity:0});
  try {
    const pdf = await task.promise;
    // Permissions are present even for encryption with an empty user password.
    if (await pdf.getPermissions() !== null) throw new ApiError(422,'encrypted_pdf','Encrypted documents are unsupported.');
    if (pdf.numPages < 1 || pdf.numPages > 50) throw new ApiError(422,'page_limit','PDF must contain at most 50 pages.');
    let hasText = false;
    for (let number=1; number<=pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const text = await page.getTextContent();
      const pageHasText = text.items.some(item=>'str' in item && item.str.trim().length>0);
      if (pageHasText) hasText = true;
      else {
        const operations = await page.getOperatorList();
        if (operations.fnArray.some(op=>[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject].includes(op)))
          throw new ApiError(422,'scanned_pdf','Each scanned page requires OCR, which this service does not support.');
      }
      page.cleanup();
    }
    if (!hasText) throw new ApiError(422,'scanned_pdf','A text-based PDF is required; scanned/image-only documents are unsupported.');
    return {pages:pdf.numPages};
  } catch(error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'PasswordException') throw new ApiError(422,'encrypted_pdf','Encrypted documents are unsupported.');
    throw new ApiError(422,'invalid_pdf','The document is not a valid supported PDF.');
  } finally {await task.destroy();}
}
