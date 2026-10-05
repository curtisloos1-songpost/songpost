'use strict';
// The picture a sender adds to a Platinum gift page. The browser sends it as a JPEG it has already made
// smaller; this checks that it really is one, reads its size, and removes what a camera writes into a file.

const MAX_SIDE = 4096, MIN_SIDE = 200;

/*
  Reads a JPEG and returns { data, width, height }, or null when the bytes are not a JPEG that can be shown.

  A JPEG is a row of labelled parts. The ones a camera or phone adds about the picture rather than of it are
  left out of data: where and when it was taken and on what device (Exif, XMP), captions and keywords (IPTC),
  and comments. The picture itself, and the colour profile it needs to look right, are kept.
*/
function cleanJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const keep = [buf.subarray(0, 2)];
  let i = 2, width = 0, height = 0, picture = false;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xff) { i++; continue; }                                   // padding between parts
    if (m === 0xda) { // the picture itself, up to its end mark; anything a file carries after that is left behind
      const end = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
      keep.push(end > i ? buf.subarray(i, end + 2) : buf.subarray(i)); picture = true; break;
    }
    if (m === 0xd9) break;
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { keep.push(buf.subarray(i, i + 2)); i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    // the part that says how large the picture is
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc && len >= 7) {
      height = buf.readUInt16BE(i + 5); width = buf.readUInt16BE(i + 7);
    }
    // kept: JFIF (e0), a colour profile (e2, when it is one), Adobe colour (ee). Dropped: Exif and XMP (e1), IPTC (ed), comments (fe), other maker notes.
    const profile = m === 0xe2 && buf.toString('latin1', i + 4, i + 16) === 'ICC_PROFILE\0';
    const about = m === 0xfe || (m >= 0xe1 && m <= 0xef && !profile && m !== 0xee);
    if (!about) keep.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  if (!picture || !width || !height) return null;
  return { data: Buffer.concat(keep), width, height };
}

// Why a picture can't be used, in words for the customer, or null when it can.
function sizeProblem(pic) {
  if (pic.width < MIN_SIDE || pic.height < MIN_SIDE) return 'That picture is too small to look good. Choose a larger one.';
  if (pic.width > MAX_SIDE || pic.height > MAX_SIDE) return 'That picture is too large. Choose a smaller one.';
  return null;
}

module.exports = { cleanJpeg, sizeProblem };
