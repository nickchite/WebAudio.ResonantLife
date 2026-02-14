export function randomRGB() {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  return `rgb(${r}, ${g}, ${b})`;
}

export function linlin(value, inMin, inMax, outMin, outMax) {
  return outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin);
}

export function linexp(value, inMin, inMax, outMin, outMax) {
  return outMin * Math.pow(outMax / outMin, (value - inMin) / (inMax - inMin));
}

export function explin(value, inMin, inMax, outMin, outMax) {
  return inMin * Math.pow(inMax / inMin, (value - outMin) / (outMax - outMin));
}

export function expexp(value, inMin, inMax, outMin, outMax) {
  return outMin * Math.pow(outMax / outMin, (value - inMin) / (inMax - inMin));
}

export class Voice {
  constructor(context) {
    this.osc = new OscillatorNode(context);
    this.gain = new GainNode(context);
    
    this.osc.connect(this.gain);
  }
  
  connect(destination) {
    this.gain.connect(destination);
    return destination;
  }
}

export class EchoDelay {
  constructor(context) {
    this.delay = new DelayNode(context);
    this.fb = new GainNode(context);

    this.delay.connect(this.fb).connect(this.delay);
  }
  
  connect(destination) {
    this.delay.connect(destination);
    return destination;
  }
}

export class Scaler {
  constructor(context, inMin, inMax, outMin, outMax) {
    this.inMin = inMin;
    this.inMax = inMax;
    this.outMin = outMin;
    this.outMax = outMax;

    this.a = new GainNode(context);
    this.b = new ConstantSourceNode(context);
    
    this.a.gain.value = (outMax - outMin) / (inMax - inMin);
    this.b.offset.value = (outMin - inMin * this.a.gain.value) / this.a.gain.value;
      
    this.b.connect(this.a);
  }
  
  connect(destination) {
    this.a.connect(destination);
    return destination;
  }
}