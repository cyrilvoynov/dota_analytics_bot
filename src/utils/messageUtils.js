const escapeHTML = (str) => {
  if (typeof str !== 'string') {
    return '';
  }
  // & must be first to avoid double escaping
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'); // HTML5 supports &apos; but &#39; is more widely compatible
};

module.exports = {
  escapeHTML,
};
