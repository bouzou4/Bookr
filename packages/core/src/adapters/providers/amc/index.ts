/**
 * The AMC Theatres provider adapter.
 *
 * @packageDocumentation
 */

export { AmcProvider, createAmcProvider, type AmcProviderOptions } from "./provider.ts";
export {
  parseSeatingLayout,
  parseShowtimesPage,
  type AmcSeatingLayout,
  type AmcShowtime,
  type AmcShowtimesPage,
} from "./flight.ts";
