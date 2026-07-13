export type PaymentMethod = "card" | "cash";
export type PublicationStatus = "review" | "published" | "hidden";

export interface City {
  id: string;
  name: string;
  active: boolean;
  pilot: boolean;
}

export interface CityStats {
  city: City;
  publishedVenues: number;
  publishedRooms: number;
  activeClientsLabel: string | null;
  audienceStage: "launching" | "growing" | "established";
  updatedAt: string;
}

export interface Venue {
  id: string;
  slug: string;
  title: string;
  city: string;
  address: string;
  description: string;
  rules: string;
  amenities: string[];
  publicationStatus: PublicationStatus;
  partnerMode: "catalog" | "crm";
  paymentMethods: PaymentMethod[];
}

export interface RoomService {
  id: string;
  name: string;
  description: string | null;
  price: number;
}

export type HourInterval = readonly [number, number];

export interface Room {
  id: string;
  slug: string;
  venueId: string;
  title: string;
  subtitle: string;
  type: string;
  capacityMin: number;
  capacityMax: number;
  pricePerHour: number;
  minimumHours: number;
  rating: number;
  reviewCount: number;
  description: string;
  rules: string;
  promotion: string | null;
  features: string[];
  tags: string[];
  photoPaths: string[];
  services: RoomService[];
  opensAtHour: number;
  closesAtHour: number;
  bufferMinutes: 0 | 15 | 30 | 45 | 60;
  defaultBlocked: HourInterval[];
  blockedByDate: Record<string, HourInterval[]>;
  publicationStatus: PublicationStatus;
}

export interface AvailabilityWindow {
  startsAt: string;
  maximumDurationMinutes: number;
  exactMatch: boolean;
}

export interface RoomSearchFilters {
  city: string;
  date?: string;
  time?: string;
  durationMinutes: number;
  guests?: number;
  type?: string;
  features: string[];
  maxPricePerHour?: number;
  sort: "rating" | "price" | "capacity";
}

export interface PublicRoomSummary {
  id: string;
  slug: string;
  venue: Venue;
  title: string;
  subtitle: string;
  type: string;
  capacityMin: number;
  capacityMax: number;
  pricePerHour: number;
  minimumHours: number;
  rating: number;
  reviewCount: number;
  features: string[];
  tags: string[];
  promotion: string | null;
  photos: string[];
  nearestWindows: AvailabilityWindow[];
}

export interface PublicRoomDetail extends PublicRoomSummary {
  description: string;
  rules: string;
  bufferMinutes: number;
  services: RoomService[];
  availability: {
    date: string;
    timezone: string;
    windows: AvailabilityWindow[];
  };
}
