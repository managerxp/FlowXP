/*
 * FlowXP Mechanic: a garage (bike, car, or both) is a spare-parts shop with the workshop always on, so it runs on the same engines (parts stock, job cards, labour, staff, billing).
 * This file only says which business types count as that, and what kind of vehicles a garage works on. No imports, so any module can use it.
 */
export const PARTS_TYPES = ['AUTO_PARTS', 'MECHANIC'];
/** A parts shop or a garage: where the parts, job card and workshop tools exist. */
export const isParts = (type) => PARTS_TYPES.includes(String(type ?? '').toUpperCase());

/** What a garage repairs: bikes and scooters, cars, or both. */
export const GARAGE_KINDS = ['BIKE', 'CAR', 'BOTH'];
/** The vehicle types (in the vehicle master) a garage of this kind works on. A parts shop (no kind) sees both. */
export const vehicleTypesFor = (kind) => (kind === 'BIKE' ? ['BIKE'] : kind === 'CAR' ? ['CAR'] : ['BIKE', 'CAR']);
