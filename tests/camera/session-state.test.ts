import { pauseForInterruption, toggleCameraFacing } from '../../src/camera/session-state';

describe('camera session transitions', () => {
  it('pauses a running session on an interruption', () => {
    expect(pauseForInterruption('running')).toBe('paused');
    expect(pauseForInterruption('paused')).toBe('paused');
    expect(pauseForInterruption('stopped')).toBe('stopped');
  });

  it('switches between front and rear cameras', () => {
    expect(toggleCameraFacing('front')).toBe('back');
    expect(toggleCameraFacing('back')).toBe('front');
  });
}); 

