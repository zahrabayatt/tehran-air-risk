/**
 * Tehran's city outline, in the map's own coordinates (a 864 by 800 frame over the CAMS grid).
 *
 * Source: OpenStreetMap relation 6663864 (the Tehran city boundary), (c) OpenStreetMap contributors, ODbL,
 * simplified to 99 points. It is embedded here, so the page loads no map tiles.
 *
 * Projection: the frame spans the whole grid, longitude 50.6 to 52.2 degrees across 864 px and latitude 36.2
 * to 35.0 degrees down 800 px, so 1 degree of longitude is 540 px and 1 degree of latitude is 666.7 px. The
 * ratio 1.235 is 1 / cos(35.6 degrees), so a km is the same length in both directions. The outline's points
 * were checked against the OSM polygon projected the same way: every point is within 0.7 px (0.05 km).
 * `projection.ts` does the same mapping from the bounds in grid.json, and projection.test.ts checks that this
 * outline, turned back into latitude and longitude, matches the OSM bounding box.
 */
export const OUTLINE_SOURCE = 'Tehran city boundary, OpenStreetMap relation 6663864, (c) OpenStreetMap contributors, ODbL';

export const OUTLINE_PATH =
  'M264 305 L282 311 L293 323 L342 344 L341 351 L344 357 L385 380 L397 393 L404 395 L432 391 L436 393 L435 397 L441 406 L443 419 L446 418 L447 412 L459 412 L458 415 L463 414 L468 421 L471 420 L462 402 L462 394 L471 388 L474 392 L487 395 L485 391 L488 390 L490 377 L493 377 L487 375 L487 370 L493 367 L499 354 L494 351 L496 349 L489 339 L483 338 L493 329 L493 322 L507 324 L513 321 L524 326 L521 323 L539 320 L539 317 L533 317 L543 304 L529 299 L517 287 L501 282 L502 272 L507 269 L507 260 L503 259 L505 256 L499 261 L490 254 L485 257 L481 251 L477 254 L466 248 L466 251 L459 255 L446 248 L442 256 L434 255 L425 261 L422 258 L419 262 L424 267 L422 271 L415 270 L411 264 L408 270 L402 271 L398 260 L397 271 L393 271 L390 275 L383 276 L379 273 L380 278 L377 281 L372 277 L373 280 L371 280 L366 277 L364 280 L360 277 L357 279 L358 286 L351 286 L341 292 L319 291 L312 288 L275 300 L267 295 L264 305 Z';
