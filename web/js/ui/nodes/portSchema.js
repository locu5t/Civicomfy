// Minimal cardType -> port schema mapping
// Extend as needed; connector names are used for auto-reconnect and bindings persistence
export const PORT_SCHEMA = {
  lora: { inputs: [], outputs: ["LoRAOut"] },
  locon: { inputs: [], outputs: ["LoRAOut"] },
  lycoris: { inputs: [], outputs: ["LoRAOut"] },
  checkpoint: { inputs: [], outputs: ["ModelOut", "CLIPOut", "VAEOut", "UNetOut", "MetaOut"] },
  diffusionmodels: { inputs: [], outputs: ["ModelOut", "CLIPOut", "VAEOut", "UNetOut", "MetaOut"] },
  vae: { inputs: [], outputs: ["VAEOut", "MetaOut"] },
  embedding: { inputs: [], outputs: ["MetaOut"] },
  controlnet: { inputs: [], outputs: ["UNetOut", "MetaOut"] },
  default: { inputs: [], outputs: [] }
};

export function schemaForType(cardType) {
  const key = String(cardType || '').toLowerCase();
  return PORT_SCHEMA[key] || PORT_SCHEMA.default;
}

