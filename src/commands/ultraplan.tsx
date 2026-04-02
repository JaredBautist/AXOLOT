export const launchUltraplan = async () => '';
export const stopUltraplan = async () => {};

export default {
  name: 'ultraplan',
  type: 'local-jsx',
  description: 'Ultraplan disabled',
  load: () => Promise.resolve({ call: () => {} })
};
