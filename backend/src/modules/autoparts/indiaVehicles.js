/*
 * The usual bikes, scooters and cars sold in India, by company, for a shop to start its vehicle list from with one click (loadDefaults below).
 *
 * Only NAMES: makes and models. No year, engine or variant, and above all no fitment. A part is still never said to fit a vehicle until the shop records it.
 * The list is a starting point from common knowledge of the Indian market, not a complete catalogue: a shop adds what is missing and can switch off what it does not stock.
 * Adding the list twice, or on top of the shop's own entries, adds only what is missing.
 */
export const INDIA_VEHICLES = {
  BIKE: {
    'Hero MotoCorp': ['Splendor Plus', 'Super Splendor', 'HF Deluxe', 'HF 100', 'Passion Pro', 'Glamour', 'Xtreme 125R', 'Xtreme 160R', 'Xpulse 200', 'Karizma XMR'],
    'Honda': ['Shine 100', 'Shine 125', 'SP 125', 'Unicorn', 'Livo', 'CD 110 Dream', 'Hornet 2.0', 'CB200X', 'CB350', 'Hness CB350'],
    'Bajaj': ['Platina 100', 'Platina 110', 'CT 100', 'CT 110', 'Pulsar 125', 'Pulsar 150', 'Pulsar N160', 'Pulsar NS200', 'Pulsar 220F', 'Avenger Street 160', 'Dominar 250', 'Dominar 400', 'Freedom 125'],
    'TVS': ['Sport', 'Star City+', 'Radeon', 'Raider 125', 'Apache RTR 160', 'Apache RTR 160 4V', 'Apache RTR 180', 'Apache RTR 200 4V', 'Apache RR 310'],
    'Royal Enfield': ['Bullet 350', 'Classic 350', 'Hunter 350', 'Meteor 350', 'Himalayan', 'Scram 411', 'Interceptor 650', 'Continental GT 650', 'Super Meteor 650'],
    'Yamaha': ['FZ-S', 'FZ-X', 'FZS-FI V4', 'MT-15', 'R15 V4', 'R15S'],
    'Suzuki': ['Gixxer', 'Gixxer SF', 'Gixxer 250', 'V-Strom SX'],
    'KTM': ['Duke 125', 'Duke 200', 'Duke 250', 'Duke 390', 'RC 200', 'RC 390', 'Adventure 390'],
    'Jawa Yezdi': ['Jawa 42', 'Jawa Perak', 'Yezdi Roadster', 'Yezdi Scrambler', 'Yezdi Adventure'],
    'Mahindra': ['Mojo'],
    'Triumph': ['Speed 400', 'Scrambler 400 X'],
    'Revolt': ['RV400'],
    'Ultraviolette': ['F77']
  },
  SCOOTER: {
    'Honda': ['Activa 6G', 'Activa 125', 'Dio', 'Dio 125'],
    'TVS': ['Jupiter', 'Jupiter 125', 'Ntorq 125', 'Scooty Pep+', 'Scooty Zest', 'iQube'],
    'Hero MotoCorp': ['Maestro Edge 110', 'Maestro Edge 125', 'Destini 125', 'Pleasure+', 'Xoom'],
    'Suzuki': ['Access 125', 'Burgman Street', 'Avenis'],
    'Yamaha': ['Fascino 125', 'RayZR 125', 'Aerox 155'],
    'Bajaj': ['Chetak'],
    'Ola Electric': ['S1 Pro', 'S1 Air', 'S1 X'],
    'Ather': ['450X', '450S', 'Rizta'],
    'Vespa': ['Vespa LX', 'Vespa SXL', 'Vespa VXL'],
    'Aprilia': ['SR 125', 'SR 160']
  },
  CAR: {
    'Maruti Suzuki': ['Alto 800', 'Alto K10', 'S-Presso', 'Wagon R', 'Celerio', 'Swift', 'Dzire', 'Baleno', 'Ignis', 'Ciaz', 'Ertiga', 'XL6', 'Brezza', 'Fronx', 'Grand Vitara', 'Jimny', 'Eeco', 'Invicto'],
    'Hyundai': ['Santro', 'Grand i10 Nios', 'i20', 'Aura', 'Verna', 'Exter', 'Venue', 'Creta', 'Alcazar', 'Tucson', 'Ioniq 5'],
    'Tata': ['Tiago', 'Tigor', 'Altroz', 'Punch', 'Nexon', 'Curvv', 'Harrier', 'Safari', 'Tiago EV', 'Nexon EV'],
    'Mahindra': ['Bolero', 'Bolero Neo', 'Scorpio Classic', 'Scorpio-N', 'Thar', 'XUV 3XO', 'XUV300', 'XUV400', 'XUV700', 'Marazzo'],
    'Kia': ['Sonet', 'Seltos', 'Carens', 'Carnival'],
    'Toyota': ['Glanza', 'Urban Cruiser Hyryder', 'Rumion', 'Innova Crysta', 'Innova Hycross', 'Fortuner', 'Camry', 'Hilux'],
    'Honda': ['Amaze', 'City', 'Elevate', 'Jazz', 'WR-V', 'Civic'],
    'Renault': ['Kwid', 'Triber', 'Kiger', 'Duster'],
    'Nissan': ['Magnite', 'Kicks', 'Sunny', 'Micra'],
    'Volkswagen': ['Polo', 'Vento', 'Virtus', 'Taigun', 'Tiguan'],
    'Skoda': ['Rapid', 'Slavia', 'Kushaq', 'Kylaq', 'Octavia', 'Superb'],
    'MG': ['Hector', 'Astor', 'Gloster', 'ZS EV', 'Comet EV', 'Windsor EV'],
    'Ford': ['Figo', 'Aspire', 'EcoSport', 'Endeavour'],
    'Chevrolet': ['Beat', 'Spark', 'Sail', 'Cruze', 'Enjoy', 'Tavera'],
    'Jeep': ['Compass', 'Meridian', 'Wrangler'],
    'Citroen': ['C3', 'C3 Aircross', 'eC3', 'C5 Aircross'],
    'Datsun': ['Go', 'Go+', 'redi-GO'],
    'Fiat': ['Punto', 'Linea'],
    'Mitsubishi': ['Pajero Sport', 'Lancer'],
    'Force': ['Gurkha', 'Trax']
  },
  COMMERCIAL: {
    'Tata': ['Ace', 'Ace Gold', 'Intra V30', '407', 'Yodha'],
    'Mahindra': ['Bolero Pik-Up', 'Jeeto', 'Supro', 'Tuv'],
    'Ashok Leyland': ['Dost', 'Bada Dost', 'Partner'],
    'Maruti Suzuki': ['Super Carry']
  }
};

/** Add the makes and models above that the business does not have yet. `types` limits it (CAR, BIKE, SCOOTER, COMMERCIAL); default all. Returns what was added. */
export const loadDefaults = async (db, businessId, types) => {
  const want = (Array.isArray(types) && types.length ? types : Object.keys(INDIA_VEHICLES)).filter((t) => INDIA_VEHICLES[t]);
  let makes = 0; let models = 0;
  for (const type of want) {
    for (const [make, list] of Object.entries(INDIA_VEHICLES[type])) {
      const m = (await db.query(
        `INSERT INTO vehicle_makes (business_id, name, vehicle_type) VALUES ($1,$2,$3)
         ON CONFLICT (business_id, lower(name), vehicle_type) DO UPDATE SET name = vehicle_makes.name RETURNING make_id, (xmax = 0) AS fresh`, [businessId, make, type])).rows[0];
      if (m.fresh) makes += 1;
      for (const name of list) {
        const r = await db.query(`INSERT INTO vehicle_models (business_id, make_id, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [businessId, m.make_id, name]);
        models += r.rowCount;
      }
    }
  }
  return { added_makes: makes, added_models: models, types: want };
};
