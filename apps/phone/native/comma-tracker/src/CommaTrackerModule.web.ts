import { registerWebModule, NativeModule } from 'expo';

class CommaTrackerModule extends NativeModule {
  start() {
    return false;
  }
  stop() {}
  isTracking() {
    return false;
  }
  readPending() {
    return [];
  }
  markUploaded() {
    return 0;
  }
  markRejected() {
    return 0;
  }
  evictUploaded() {
    return 0;
  }
  gnssOffsetMs() {
    return null;
  }
  requestBatteryOptimizationSettings() {
    return false;
  }
  setNotice() {}
}

export default registerWebModule(CommaTrackerModule, 'CommaTrackerModule');
