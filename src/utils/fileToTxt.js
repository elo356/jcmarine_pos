export const fileToTxt = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => {
      // Guarda la imagen como DataURL (texto) para persistirla donde se necesite
      resolve(String(reader.result || ''));
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
};

export default fileToTxt;
