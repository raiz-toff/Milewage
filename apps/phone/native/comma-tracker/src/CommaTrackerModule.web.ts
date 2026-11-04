import { registerWebModule, NativeModule } from 'expo';

class CommaTrackerModule extends NativeModule {
  startTracking() {
    return false;
  }
  stopTracking() {}
  requestBatteryOptimizationSettings() {
    return false;
  }
  getActiveDistanceMeters() {
    return 0;
  }
}

export default registerWebModule(CommaTrackerModule, 'CommaTrackerModule');
