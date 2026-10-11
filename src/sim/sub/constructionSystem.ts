// Строительство и рост: стройки, новые дома, приезжие, версии карты для перерисовки.
import type { Simulation } from '../game';
import type { Building } from '../../world/buildings';
import { onBuildingDestroyed, updateConstruction, updateGrowth } from '../construction';

export class ConstructionSystem {
  /** Версии для перерисовки (здания/тайлы) */
  buildingVersion = 0;
  tileVersion = 0;

  update(sim: Simulation): void {
    updateConstruction(sim);
    updateGrowth(sim);
  }

  /** Здание разрушено (пожар, дракон, наводнение): руины, переселение, хроника */
  destroyed(sim: Simulation, b: Building, cause: string): void {
    onBuildingDestroyed(sim, b, cause);
  }
}
