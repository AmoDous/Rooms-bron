import type { City, CityStats, Room, RoomSearchFilters, Venue } from "./types.js";

export const venueIds = {
  kidsLoft: "10000000-0000-4000-8000-000000000001",
  voiceRoom: "10000000-0000-4000-8000-000000000002",
  terrace36: "10000000-0000-4000-8000-000000000003",
  myboxLounge: "10000000-0000-4000-8000-000000000004",
} as const;

export const roomIds = {
  kosmos: "20000000-0000-4000-8000-000000000001",
  safari: "20000000-0000-4000-8000-000000000002",
  voiceSmall: "20000000-0000-4000-8000-000000000003",
  voiceVip: "20000000-0000-4000-8000-000000000004",
  terraceHall: "20000000-0000-4000-8000-000000000005",
  myboxRoom: "20000000-0000-4000-8000-000000000006",
} as const;

const venues: Venue[] = [
  {
    id: venueIds.kidsLoft,
    slug: "kids-loft",
    title: "Kids Loft",
    city: "Воронеж",
    address: "ул. Карла Маркса, 54",
    description: "Семейный лофт с двумя отдельными комнатами для детских и семейных событий.",
    rules: "Алкоголь и кальян не подходят для детских мероприятий. Еду и торт можно согласовать заранее.",
    amenities: ["детская зона", "парковка", "можно со своей едой"],
    publicationStatus: "published",
    partnerMode: "catalog",
    paymentMethods: ["card", "cash"],
  },
  {
    id: venueIds.voiceRoom,
    slug: "voice-room",
    title: "Voice Room",
    city: "Воронеж",
    address: "пр-т Революции, 29",
    description: "Караоке-комнаты разного размера с приватным входом, звуком и отдельным обслуживанием.",
    rules: "Только для гостей 18+. Депозит и правила бара подтверждает площадка.",
    amenities: ["караоке", "бар", "18+"],
    publicationStatus: "published",
    partnerMode: "catalog",
    paymentMethods: ["card", "cash"],
  },
  {
    id: venueIds.terrace36,
    slug: "terrace-36",
    title: "Terrace 36",
    city: "Воронеж",
    address: "Плехановская, 22",
    description: "Светлый зал для банкетов, выпускных и камерных событий с возможностью привезти декор.",
    rules: "Декор и меню согласуются с менеджером после подтверждения заявки.",
    amenities: ["банкет", "кухня", "парковка"],
    publicationStatus: "published",
    partnerMode: "catalog",
    paymentMethods: ["card", "cash"],
  },
  {
    id: venueIds.myboxLounge,
    slug: "mybox-lounge",
    title: "MYBOX Lounge",
    city: "Москва",
    address: "Новый Арбат, 12",
    description: "Демо-площадка для проверки выбора города и каталога.",
    rules: "Только для гостей 18+.",
    amenities: ["лаундж", "18+", "парковка"],
    publicationStatus: "published",
    partnerMode: "catalog",
    paymentMethods: ["card", "cash"],
  },
];

const rooms: Room[] = [
  {
    id: roomIds.kosmos,
    slug: "kosmos",
    venueId: venueIds.kidsLoft,
    title: "Комната Космос",
    subtitle: "Детская комната",
    type: "kids",
    capacityMin: 1,
    capacityMax: 14,
    pricePerHour: 1600,
    minimumHours: 2,
    rating: 4.9,
    reviewCount: 42,
    description: "Отдельная комната для детского праздника: сухой бассейн, место для чаепития и зона для родителей.",
    rules: "Можно со своим тортом. Алкоголь и кальян не подходят для этого формата.",
    promotion: "При брони от 3 часов именинника ждёт подарок от площадки.",
    features: ["kids", "parking", "food"],
    tags: ["аниматоры", "торт", "игровая зона"],
    photoPaths: ["assets/kids-loft.jpg", "assets/banquet-hall.jpg", "assets/lounge-room.jpg"],
    services: [
      { id: "30000000-0000-4000-8000-000000000001", name: "Аниматор", description: "Игровая программа на один час.", price: 4000 },
      { id: "30000000-0000-4000-8000-000000000002", name: "Украшение комнаты", description: "Базовый декор к началу события.", price: 2500 },
    ],
    opensAtHour: 10,
    closesAtHour: 24,
    bufferMinutes: 0,
    defaultBlocked: [[18, 20]],
    blockedByDate: {},
    publicationStatus: "published",
  },
  {
    id: roomIds.safari,
    slug: "safari",
    venueId: venueIds.kidsLoft,
    title: "Комната Сафари",
    subtitle: "Детская комната",
    type: "kids",
    capacityMin: 1,
    capacityMax: 10,
    pricePerHour: 1300,
    minimumHours: 2,
    rating: 4.8,
    reviewCount: 31,
    description: "Небольшая тёплая комната для праздника младших детей и семейных встреч.",
    rules: "Подходит для детей до 8 лет, можно принести еду и украшения.",
    promotion: null,
    features: ["kids", "food"],
    tags: ["до 10 гостей", "мягкая зона", "мастер-класс"],
    photoPaths: ["assets/kids-loft.jpg", "assets/lounge-room.jpg", "assets/banquet-hall.jpg"],
    services: [
      { id: "30000000-0000-4000-8000-000000000003", name: "Мастер-класс", description: "Творческое занятие для группы детей.", price: 3500 },
    ],
    opensAtHour: 10,
    closesAtHour: 22,
    bufferMinutes: 0,
    defaultBlocked: [[17, 19]],
    blockedByDate: {},
    publicationStatus: "published",
  },
  {
    id: roomIds.voiceSmall,
    slug: "voice-small",
    venueId: venueIds.voiceRoom,
    title: "Караоке Small",
    subtitle: "Караоке-комната",
    type: "karaoke",
    capacityMin: 1,
    capacityMax: 8,
    pricePerHour: 2200,
    minimumHours: 2,
    rating: 4.7,
    reviewCount: 64,
    description: "Отдельная комната для компании до 8 гостей: караоке, обслуживание и закрытый формат.",
    rules: "18+. Депозит и правила бара подтверждает площадка.",
    promotion: null,
    features: ["karaoke", "alcohol", "parking", "adult"],
    tags: ["18+", "звук", "бар"],
    photoPaths: ["assets/karaoke-room.jpg", "assets/lounge-room.jpg", "assets/banquet-hall.jpg"],
    services: [
      { id: "30000000-0000-4000-8000-000000000004", name: "Дополнительный микрофон", description: "Ещё один микрофон для гостей.", price: 500 },
      { id: "30000000-0000-4000-8000-000000000005", name: "Фотограф на час", description: "Фотосъёмка события от одного часа.", price: 3500 },
    ],
    opensAtHour: 12,
    closesAtHour: 24,
    bufferMinutes: 0,
    defaultBlocked: [[19, 21]],
    blockedByDate: {},
    publicationStatus: "published",
  },
  {
    id: roomIds.voiceVip,
    slug: "voice-vip",
    venueId: venueIds.voiceRoom,
    title: "VIP Lounge",
    subtitle: "Лаундж-комната",
    type: "lounge",
    capacityMin: 1,
    capacityMax: 12,
    pricePerHour: 2600,
    minimumHours: 2,
    rating: 4.8,
    reviewCount: 53,
    description: "Приватная лаундж-комната для взрослой компании с мягкой зоной и караоке.",
    rules: "18+. Кальян и алкоголь доступны по правилам площадки.",
    promotion: "Скидка 10% на дополнительный час с воскресенья по четверг.",
    features: ["alcohol", "hookah", "karaoke", "projector", "adult"],
    tags: ["18+", "кальян", "караоке"],
    photoPaths: ["assets/lounge-room.jpg", "assets/karaoke-room.jpg", "assets/banquet-hall.jpg"],
    services: [
      { id: "30000000-0000-4000-8000-000000000006", name: "Кальян", description: "Один кальян по меню площадки.", price: 1900 },
    ],
    opensAtHour: 12,
    closesAtHour: 24,
    bufferMinutes: 0,
    defaultBlocked: [[18, 20]],
    blockedByDate: {},
    publicationStatus: "published",
  },
  {
    id: roomIds.terraceHall,
    slug: "terrace-hall",
    venueId: venueIds.terrace36,
    title: "Большой зал",
    subtitle: "Банкетный зал",
    type: "banquet",
    capacityMin: 1,
    capacityMax: 40,
    pricePerHour: 3400,
    minimumHours: 3,
    rating: 4.9,
    reviewCount: 27,
    description: "Светлый зал для дня рождения, выпускного или камерного банкета с отдельной посадкой.",
    rules: "Декор и меню согласуются с менеджером после подтверждения заявки.",
    promotion: null,
    features: ["parking", "food", "alcohol", "projector", "kitchen"],
    tags: ["до 40 гостей", "сцена", "кухня"],
    photoPaths: ["assets/banquet-hall.jpg", "assets/lounge-room.jpg", "assets/kids-loft.jpg"],
    services: [
      { id: "30000000-0000-4000-8000-000000000007", name: "Проектор и экран", description: "Для презентаций, фото или видео.", price: 1500 },
      { id: "30000000-0000-4000-8000-000000000008", name: "Сервировка зала", description: "Подготовка стола и базовая сервировка.", price: 2500 },
    ],
    opensAtHour: 10,
    closesAtHour: 24,
    bufferMinutes: 0,
    defaultBlocked: [[15, 18]],
    blockedByDate: {},
    publicationStatus: "published",
  },
  {
    id: roomIds.myboxRoom,
    slug: "mybox-room",
    venueId: venueIds.myboxLounge,
    title: "Мягкая комната",
    subtitle: "Лаундж",
    type: "lounge",
    capacityMin: 1,
    capacityMax: 10,
    pricePerHour: 3000,
    minimumHours: 2,
    rating: 4.6,
    reviewCount: 18,
    description: "Демо-комната в Москве для проверки смены города.",
    rules: "18+. Детские события сюда не выводим.",
    promotion: null,
    features: ["parking", "alcohol", "hookah", "projector", "adult"],
    tags: ["18+", "мягкая зона", "бар"],
    photoPaths: ["assets/lounge-room.jpg", "assets/karaoke-room.jpg", "assets/banquet-hall.jpg"],
    services: [],
    opensAtHour: 11,
    closesAtHour: 24,
    bufferMinutes: 0,
    defaultBlocked: [[18, 21]],
    blockedByDate: {},
    publicationStatus: "published",
  },
];

export interface CatalogRepository {
  readonly storage: "memory" | "postgresql";
  listCities(): Promise<City[]>;
  getCityStats(idOrName: string): Promise<CityStats | null>;
  listVenues(): Promise<Venue[]>;
  searchRooms(filters: RoomSearchFilters): Promise<Room[]>;
  findRoom(idOrSlug: string): Promise<Room | null>;
  findVenue(id: string): Promise<Venue | null>;
}

export class MemoryCatalogRepository implements CatalogRepository {
  readonly storage = "memory" as const;

  constructor(private readonly activeClientsByCity: Readonly<Record<string, number>> = {}) {}

  private cityId(name: string): string {
    return name.toLocaleLowerCase("ru-RU").replace(/\s+/g, "-");
  }

  private audienceLabel(count: number): string | null {
    const threshold = [1000, 500, 200, 100, 50, 20].find((value) => count >= value);
    return threshold ? `${threshold.toLocaleString("ru-RU")}+` : null;
  }

  async listCities(): Promise<City[]> {
    const names = [...new Set(venues.filter((venue) => venue.publicationStatus === "published").map((venue) => venue.city))];
    return names.map((name) => ({
      id: this.cityId(name),
      name,
      active: true,
      pilot: name === "Воронеж",
    }));
  }

  async getCityStats(idOrName: string): Promise<CityStats | null> {
    const value = idOrName.trim().toLocaleLowerCase("ru-RU");
    const city = (await this.listCities()).find((item) => item.id === value || item.name.toLocaleLowerCase("ru-RU") === value);
    if (!city) return null;
    const cityVenues = venues.filter((venue) => venue.publicationStatus === "published" && venue.city === city.name);
    const venueSet = new Set(cityVenues.map((venue) => venue.id));
    const publishedRooms = rooms.filter((room) => room.publicationStatus === "published" && venueSet.has(room.venueId)).length;
    const activeClients = Math.max(0, Number(this.activeClientsByCity[city.name] ?? this.activeClientsByCity[city.id] ?? 0));
    const activeClientsLabel = this.audienceLabel(activeClients);
    return {
      city,
      publishedVenues: cityVenues.length,
      publishedRooms,
      activeClientsLabel,
      audienceStage: activeClients >= 100 ? "established" : activeClients >= 20 ? "growing" : "launching",
      updatedAt: new Date().toISOString(),
    };
  }

  async listVenues(): Promise<Venue[]> {
    return structuredClone(venues.filter((venue) => venue.publicationStatus === "published"));
  }

  async searchRooms(filters: RoomSearchFilters): Promise<Room[]> {
    const cityVenueIds = new Set(
      venues
        .filter((venue) => venue.publicationStatus === "published" && venue.city === filters.city)
        .map((venue) => venue.id),
    );
    const found = rooms.filter((room) => {
      if (room.publicationStatus !== "published" || !cityVenueIds.has(room.venueId)) return false;
      if (filters.guests && room.capacityMax < filters.guests) return false;
      if (filters.type && filters.type !== "any" && room.type !== filters.type) return false;
      if (filters.maxPricePerHour && room.pricePerHour > filters.maxPricePerHour) return false;
      return filters.features.every((feature) => room.features.includes(feature));
    });
    const sorters: Record<RoomSearchFilters["sort"], (left: Room, right: Room) => number> = {
      rating: (left, right) => right.rating - left.rating || right.reviewCount - left.reviewCount,
      price: (left, right) => left.pricePerHour - right.pricePerHour || right.rating - left.rating,
      capacity: (left, right) => right.capacityMax - left.capacityMax || right.rating - left.rating,
    };
    return structuredClone(found.sort(sorters[filters.sort]));
  }

  async findRoom(idOrSlug: string): Promise<Room | null> {
    const room = rooms.find((item) => item.id === idOrSlug || item.slug === idOrSlug);
    return room?.publicationStatus === "published" ? structuredClone(room) : null;
  }

  async findVenue(id: string): Promise<Venue | null> {
    const venue = venues.find((item) => item.id === id);
    return venue?.publicationStatus === "published" ? structuredClone(venue) : null;
  }
}
