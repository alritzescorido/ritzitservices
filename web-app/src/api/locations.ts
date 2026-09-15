import type { Location, LocationWithPath } from './types';

/**
 * `GET /locations?parent=` returns bare rows: psgc_code, name, level and no
 * display_name or path. Only the search and single-location endpoints build
 * those. When a child is picked out of such a list, fill both in from the
 * parent that was already chosen, so the value looks and behaves like one that
 * came from search.
 */
export function placeUnder(child: Location, parent: LocationWithPath): LocationWithPath {
  return {
    ...child,
    display_name: `${child.name}, ${parent.display_name}`,
    path: [...(parent.path ?? []), { psgc_code: parent.psgc_code, parent_code: parent.parent_code, level: parent.level, name: parent.name }],
  };
}
