import { ModelStatusService } from '../../src/services/model-status';

describe('model status', () => {
  it('reports the bundled isolated-word vocabulary separately from ASL grammar translation', () => {
    const status = ModelStatusService.getStatus();
    expect(status.ready).toBe(true);
    expect(status.trackingBundled).toBe(true);
    expect(status.supportsGrammar).toBe(true);
    expect(status.supportedSigns).toHaveLength(2917);
    expect(status.supportedSigns).toContain('HELP');
    expect(status.message).toMatch(/pretrained.*model/i);
    expect(status.sentenceTranslation).toBe('experimental-offline');
    expect(status.message).toMatch(/Live sentence accuracy is unvalidated/i);
  });
}); 

