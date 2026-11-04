import { defineModule } from '@milewage/shared';

export const coreModule = defineModule({ name: 'core', dependsOn: [], toggleable: false });

export const serverModules = [coreModule] as const;
