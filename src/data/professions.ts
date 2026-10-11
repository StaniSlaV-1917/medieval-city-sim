// Таблица «здание → профессии работников» (вместо switch). Индекс работника выбирает должность:
// первые записи — для первых нанятых, последняя повторяется для остальных.
import { BuildingType } from '../world/buildings';
import { Profession } from '../sim/citizen';

export const WORKPLACE_PROFESSIONS: Partial<Record<BuildingType, Profession[]>> = {
  [BuildingType.Farm]: [Profession.Farmer],
  [BuildingType.Mill]: [Profession.Miller],
  [BuildingType.Bakery]: [Profession.Baker],
  [BuildingType.Butcher]: [Profession.Butcher],
  [BuildingType.Smithy]: [Profession.Smith],
  [BuildingType.Carpenter]: [Profession.Carpenter],
  [BuildingType.Sawmill]: [Profession.Woodcutter],
  [BuildingType.Mason]: [Profession.Mason],
  [BuildingType.Quarry]: [Profession.Quarryman],
  [BuildingType.Tannery]: [Profession.Tanner],
  [BuildingType.Merchant]: [Profession.Merchant],
  [BuildingType.Warehouse]: [Profession.Merchant],
  [BuildingType.MarketStall]: [Profession.Merchant],
  [BuildingType.Tavern]: [Profession.Innkeeper, Profession.Innkeeper, Profession.Bard, Profession.Innkeeper],
  [BuildingType.TownHall]: [Profession.Burgomaster, Profession.Herald, Profession.Servant],
  [BuildingType.Cathedral]: [Profession.Priest],
  [BuildingType.Monastery]: [Profession.Monk],
  [BuildingType.Barracks]: [Profession.Guard],
  [BuildingType.Prison]: [Profession.Guard],
  [BuildingType.Stable]: [Profession.Stablehand],
  [BuildingType.FireTower]: [Profession.Fireman],
  [BuildingType.Castle]: [Profession.Servant],
};

export function professionForWorkplace(type: BuildingType, index: number): Profession {
  const list = WORKPLACE_PROFESSIONS[type];
  if (!list || !list.length) return Profession.None;
  return list[Math.min(index, list.length - 1)];
}
