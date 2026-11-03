export interface Product {
  slug: string;
  name: string;
  price: number;
  blurb: string;
  reviews: { author: string; stars: number; text: string }[];
}

export const products: Product[] = [
  {
    slug: "espresso-machine",
    name: "Espresso Machine",
    price: 349,
    blurb: "A compact machine with a 58 mm portafilter and a steam wand.",
    reviews: [
      { author: "A.", stars: 5, text: "Pulls a great shot." },
      { author: "B.", stars: 4, text: "Steam wand is a little slow." },
    ],
  },
  {
    slug: "burr-grinder",
    name: "Burr Grinder",
    price: 129,
    blurb: "Conical burrs, 40 grind settings.",
    reviews: [{ author: "C.", stars: 5, text: "Consistent grind." }],
  },
  {
    slug: "milk-jug",
    name: "Milk Jug",
    price: 19,
    blurb: "350 ml stainless steel.",
    reviews: [],
  },
];

export const getProduct = (slug: string) => products.find((p) => p.slug === slug);
