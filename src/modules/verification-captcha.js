const crypto = require('node:crypto');
const path = require('node:path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const FONT_NAME = 'SServiceCaptcha';
const fontPath = path.join(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf');
let fontLoaded = false;

function randomCode() {
  const digits = '23456789';
  return Array.from({ length: 6 }, () => digits[crypto.randomInt(digits.length)]).join('');
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index--) {
    const other = crypto.randomInt(index + 1);
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

async function renderCaptcha(code) {
  if (!/^[2-9]{6}$/.test(code))
    throw new Error('Captcha codes must contain six digits from 2 to 9.');
  if (!fontLoaded) {
    if (!GlobalFonts.registerFromPath(fontPath, FONT_NAME))
      throw new Error('Could not load the bundled captcha font.');
    fontLoaded = true;
  }
  const canvas = createCanvas(640, 180);
  const context = canvas.getContext('2d');
  const background = context.createLinearGradient(0, 0, 640, 180);
  background.addColorStop(0, '#17171d');
  background.addColorStop(1, '#2a141c');
  context.fillStyle = background;
  context.fillRect(0, 0, 640, 180);
  context.fillStyle = '#f91c2b';
  context.fillRect(0, 0, 640, 4);
  for (let index = 0; index < 200; index++) {
    context.fillStyle = index % 2 ? 'rgba(249,28,43,0.4)' : 'rgba(220,220,230,0.18)';
    context.beginPath();
    context.arc(
      crypto.randomInt(640),
      crypto.randomInt(12, 164),
      crypto.randomInt(1, 3),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  for (let index = 0; index < 4; index++) {
    context.strokeStyle = 'rgba(249,28,43,0.22)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, crypto.randomInt(25, 150));
    context.bezierCurveTo(
      180,
      crypto.randomInt(180),
      460,
      crypto.randomInt(180),
      640,
      crypto.randomInt(25, 150),
    );
    context.stroke();
  }
  for (const [index, digit] of [...code].entries()) {
    context.save();
    context.translate(70 + index * 96, crypto.randomInt(87, 105));
    context.rotate((crypto.randomInt(-15, 16) * Math.PI) / 180);
    context.font = `${crypto.randomInt(72, 83)}px ${FONT_NAME}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 3;
    context.strokeStyle = '#101015';
    context.strokeText(digit, 0, 0);
    context.fillStyle = index % 2 ? '#ff5865' : '#f3f1f5';
    context.fillText(digit, 0, 0);
    context.restore();
  }
  context.strokeStyle = 'rgba(249,28,43,0.38)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(15, 110);
  context.bezierCurveTo(190, 40, 440, 160, 625, 85);
  context.stroke();
  context.fillStyle = '#9e929a';
  context.font = `12px ${FONT_NAME}`;
  context.fillText('S-SERVICE  /  VERIFICATION', 20, 167);
  return canvas.encode('png');
}

async function createCaptcha() {
  const answer = randomCode();
  const codes = new Set([answer]);
  while (codes.size < 6) codes.add(randomCode());
  let correctValue;
  const options = shuffle([...codes]).map((label) => {
    const value = crypto.randomBytes(16).toString('hex');
    if (label === answer) correctValue = value;
    return { label, value };
  });
  return { id: crypto.randomUUID(), options, correctValue, image: await renderCaptcha(answer) };
}

module.exports = { createCaptcha, renderCaptcha };
