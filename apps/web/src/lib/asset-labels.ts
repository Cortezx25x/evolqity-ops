import type { AssetType } from '../api/types';

export function assetTypeLabel(type: AssetType): string {
  switch (type) {
    case 'VEHICLE':
      return 'Vehículo';
    case 'EQUIPMENT':
      return 'Equipo';
    case 'DEVICE':
      return 'Dispositivo';
    case 'OTHER':
      return 'Otro';
    default:
      return type;
  }
}
