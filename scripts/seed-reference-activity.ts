import 'reflect-metadata';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import mongoose from 'mongoose';
import { validateOptions } from '../src/catalog/activity-booking.utils';
import { CreateActivityDto } from '../src/catalog/dto/create-activity.dto';
import { Activity, ActivitySchema } from '../src/catalog/schemas/activity.schema';
import { Review, ReviewSchema } from '../src/reviews/schemas/review.schema';

const slug = 'dubai-desert-safari-complete-example';
const money = (amount: number) => ({ amount, currency: 'AED' });

const referenceActivity = {
  title: 'Dubai Desert Safari – Complete Activity Example',
  slug,
  summary:
    'A complete, ready-to-edit example showing how every activity field appears on the public booking page.',
  destinations: ['Dubai', 'United Arab Emirates'],
  categories: ['Desert Safari', 'Adventure Tours', 'Family Experiences'],
  duration: '7 hours',
  imageUrl: '/images/cms-f459ceb02a71e61b.jpg',
  heroVideo: { url: '/videos/clip-1791820513613-vjc4p0.mp4' },
  gallery: [
    { url: '/images/cms-f459ceb02a71e61b.jpg', alt: 'Guests enjoying a Dubai desert experience' },
    { url: '/images/cms-691eb2b4ae6758e1.webp', alt: 'Golden dunes during the afternoon safari' },
    { url: '/images/cms-af5b5a03f04d9e78.webp', alt: 'Traditional desert camp experience' },
    { url: '/images/cms-64226d4c00e693e3.webp', alt: 'Evening entertainment at the desert camp' },
    { url: '/images/cms-31f509acfa338fba.webp', alt: 'Sunset views across the Dubai desert' },
  ],
  price: money(325),
  salePrice: money(249),
  operatingHours: 'Daily, pickup between 14:00 and 15:30',
  languages: ['English', 'Arabic', 'Hindi'],
  instantConfirmation: true,
  mobileVoucher: true,
  freeCancellationHours: 24,
  description:
    'Leave the city behind for an afternoon of dune-filled adventure and warm Arabian hospitality. Your experience begins with a convenient Dubai pickup before a professional safari guide drives you into the Lahbab desert in a modern, air-conditioned 4×4.\n\nAfter a short comfort stop, enjoy exhilarating dune bashing, pause for sunset photographs and try sandboarding on the red dunes. The evening continues at a traditional-style desert camp with a welcome drink, camel ride, cultural activities and a generous barbecue buffet.\n\nThis reference activity is intentionally complete. Future administrators can open it in the Activities manager to see the recommended amount and style of information for every available field.',
  highlights: [
    'Ride across the red dunes in a 4×4 driven by a licensed desert safari guide.',
    'Capture panoramic sunset photographs from a high dune viewpoint.',
    'Try sandboarding and enjoy a short camel ride at the desert camp.',
    'Relax over a barbecue buffet with vegetarian and non-vegetarian selections.',
    'Watch family-friendly live entertainment inspired by regional traditions.',
  ],
  inclusions: [
    'Dubai hotel pickup and drop-off in an air-conditioned 4×4',
    'Dune bashing and sandboarding equipment',
    'Short camel ride and sunset photography stop',
    'Barbecue buffet dinner with unlimited water and soft drinks',
    'Live evening entertainment and camp activities',
  ],
  exclusions: [
    'Alcoholic beverages and premium menu upgrades',
    'Quad bike or dune buggy sessions unless selected separately',
    'Professional photography and souvenirs',
    'Gratuities and personal expenses',
  ],
  whatToBring: [
    'Original passport or Emirates ID for identification',
    'Comfortable closed shoes and lightweight clothing',
    'A light jacket during cooler winter evenings',
    'Sunscreen, sunglasses and a fully charged phone or camera',
  ],
  itinerary: [
    {
      title: 'Hotel pickup',
      duration: '14:00–15:30',
      description: 'Meet your safari guide at your Dubai hotel. The exact pickup time is confirmed on the day before travel.',
      imageUrl: '/images/cms-f459ceb02a71e61b.jpg',
    },
    {
      title: 'Red-dune safari',
      duration: '45 minutes',
      description: 'Travel into the Lahbab desert for dune bashing with photo stops and time to try sandboarding.',
      imageUrl: '/images/cms-691eb2b4ae6758e1.webp',
    },
    {
      title: 'Sunset viewpoint',
      duration: '20 minutes',
      description: 'Pause on a high dune for sunset views and photographs while the guide prepares the vehicle for camp.',
      imageUrl: '/images/cms-31f509acfa338fba.webp',
    },
    {
      title: 'Desert camp and dinner',
      duration: '3 hours',
      description: 'Enjoy a camel ride, welcome refreshments, cultural activities, buffet dinner and scheduled live entertainment.',
      imageUrl: '/images/cms-64226d4c00e693e3.webp',
    },
    {
      title: 'Return to Dubai',
      duration: '21:00–22:00',
      description: 'Meet your driver after the final show and relax on the return journey to your original pickup point.',
    },
  ],
  howToRedeem: [
    'Show the mobile voucher and a matching photo ID to the guide at pickup.',
    'Keep your reachable WhatsApp number active for the pickup confirmation.',
    'Be ready in the hotel lobby at least 10 minutes before the confirmed time.',
  ],
  importantInfo: [
    'Pickup timing varies by season, traffic and hotel location.',
    'Dune bashing is not recommended for pregnant guests or people with serious back, neck or heart conditions.',
    'Children must be accompanied by a responsible adult throughout the experience.',
    'Entertainment schedules can change during religious holidays and official mourning periods.',
    'Large luggage, pets and outside food are not permitted in the shared vehicle.',
  ],
  cancellationPolicy: [
    'Cancel at least 24 hours before the confirmed pickup time for a full refund.',
    'Late cancellations and no-shows are non-refundable.',
    'Supplier cancellations caused by unsafe weather receive a new date or full refund.',
    'Approved refunds are returned to the original payment method.',
  ],
  faqs: [
    {
      question: 'Is this activity suitable for young children?',
      answer: 'Yes. Families are welcome, but children who cannot safely join dune bashing may travel directly to camp when a suitable private option is arranged in advance.',
    },
    {
      question: 'What should I wear?',
      answer: 'Choose comfortable, modest clothing and closed shoes. Bring a light jacket between November and March because desert evenings can feel cool.',
    },
    {
      question: 'Are vegetarian meals available?',
      answer: 'Yes. The buffet includes vegetarian selections. Tell the team before travel about allergies or strict dietary requirements.',
    },
    {
      question: 'Can I book a private vehicle?',
      answer: 'Yes. Select the private 4×4 option for a vehicle reserved for your group of up to six guests.',
    },
  ],
  contentSections: [
    {
      title: 'Who this experience is for',
      body: 'This balanced afternoon-to-evening program works especially well for first-time Dubai visitors, couples, families and small groups who want adventure and cultural activities in one booking.',
      items: ['First-time UAE visitors', 'Families with school-age children', 'Couples and small groups', 'Guests looking for a convenient hotel-to-hotel experience'],
    },
    {
      title: 'Responsible desert travel',
      body: 'Help protect the desert environment by following your guide and leaving natural areas undisturbed.',
      items: ['Carry reusable water bottles where practical', 'Do not leave litter on the dunes', 'Avoid feeding or approaching wildlife', 'Respect local customs and camp guidelines'],
    },
  ],
  location: {
    name: 'Lahbab Desert',
    address: 'Lahbab, Dubai, United Arab Emirates',
    lat: 25.0426,
    lng: 55.5914,
  },
  options: [
    {
      id: 'shared-transfer-standard',
      name: 'Standard safari with shared transfer',
      transferType: 'sharing',
      startTime: '14:30',
      durationLabel: 'Approximately 7 hours',
      adultPrice: money(249),
      childPrice: money(199),
      childAgeRange: '3–11 years',
      minPax: 1,
      maxPax: 6,
      pickupRequired: true,
      refundable: true,
      freeCancellationHours: 24,
      operatingWeekdays: [0, 1, 2, 3, 4, 5, 6],
      blackoutDates: ['2027-01-01'],
      dailyCapacity: 48,
      cutoffHours: 6,
    },
    {
      id: 'private-transfer-premium',
      name: 'Premium safari with private 4×4',
      transferType: 'private',
      startTime: '15:00',
      durationLabel: 'Approximately 7 hours',
      adultPrice: money(449),
      childPrice: money(349),
      childAgeRange: '3–11 years',
      minPax: 2,
      maxPax: 6,
      pickupRequired: true,
      refundable: true,
      freeCancellationHours: 48,
      operatingWeekdays: [0, 1, 2, 3, 4, 5, 6],
      blackoutDates: ['2027-01-01'],
      dailyCapacity: 18,
      cutoffHours: 12,
    },
  ],
  published: true,
  isSample: false,
};

const sampleReviews = [
  {
    displayName: 'Aisha K. (demo)',
    rating: 5,
    title: 'A wonderful family evening',
    body: 'The pickup was punctual, our guide explained everything clearly, and the sunset stop was beautiful. The children especially enjoyed sandboarding and the camel ride.',
    images: ['/images/cms-691eb2b4ae6758e1.webp'],
    createdAt: new Date('2026-09-28T12:00:00.000Z'),
  },
  {
    displayName: 'Daniel M. (demo)',
    rating: 5,
    title: 'Excellent guide and smooth organisation',
    body: 'Communication before pickup was very good. Dune bashing was exciting without feeling rushed, and the dinner had plenty of choices.',
    images: [],
    createdAt: new Date('2026-09-17T15:30:00.000Z'),
  },
  {
    displayName: 'Priya S. (demo)',
    rating: 4,
    title: 'Great first desert experience',
    body: 'A well-planned afternoon with enough time for photos and activities. The camp became busy in the evening, but the staff remained helpful throughout.',
    images: ['/images/cms-31f509acfa338fba.webp'],
    createdAt: new Date('2026-08-31T09:15:00.000Z'),
  },
  {
    displayName: 'Omar R. (demo)',
    rating: 5,
    title: 'The private vehicle was worth it',
    body: 'We selected the private transfer and could adjust the photo stops for our group. Our driver was professional and made the dune ride memorable.',
    images: [],
    createdAt: new Date('2026-08-12T17:45:00.000Z'),
  },
  {
    displayName: 'Sofia L. (demo)',
    rating: 4,
    title: 'Beautiful sunset and enjoyable dinner',
    body: 'The sunset viewpoint was the highlight for us. Dinner and entertainment were enjoyable, and the return transfer was comfortable.',
    images: ['/images/cms-64226d4c00e693e3.webp'],
    createdAt: new Date('2026-07-26T11:20:00.000Z'),
  },
];

async function run() {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
  const dto = plainToInstance(CreateActivityDto, referenceActivity);
  await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
  const optionProblem = validateOptions(dto.options ?? []);
  if (optionProblem) throw new Error(optionProblem);

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const activities = mongoose.model<Activity>(Activity.name, ActivitySchema);
  const reviews = mongoose.model<Review>(Review.name, ReviewSchema);
  await Promise.all([activities.init(), reviews.init()]);

  const { title, summary, isSample, ...fields } = dto;
  const result = await activities.findOneAndUpdate(
    { slug },
    {
      $set: {
        ...fields,
        title: { en: title },
        summary: summary ? { en: summary } : undefined,
        source: 'reference-seed',
        published: true,
        detailsAreSample: isSample ?? false,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );

  for (const [index, review] of sampleReviews.entries()) {
    const bookingReference = `DEMO-DS-${String(index + 1).padStart(3, '0')}`;
    await reviews.updateOne(
      { bookingReference },
      {
        $set: {
          activitySlug: slug,
          displayName: review.displayName,
          rating: review.rating,
          title: review.title,
          body: review.body,
          images: review.images,
          status: 'published',
          moderatedAt: review.createdAt,
          createdAt: review.createdAt,
          updatedAt: review.createdAt,
        },
        $setOnInsert: {
          bookingId: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(),
          bookingReference,
        },
      },
      { upsert: true },
    );
  }

  console.log(JSON.stringify({ id: String(result?._id), slug, published: result?.published, demoReviews: sampleReviews.length }, null, 2));
  await mongoose.disconnect();
}

run().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
