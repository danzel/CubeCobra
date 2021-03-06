const mongoose = require('mongoose');

const Card = {
  tags: [
    {
      type: String,
      minlength: 1,
    },
  ],
  finish: {
    type: String,
    enum: ['Foil', 'Non-foil'],
    default: 'Non-foil',
  },
  status: {
    type: String,
    enum: ['Not Owned', 'Ordered', 'Owned', 'Premium Owned', 'Proxied'],
    default: 'Not Owned',
  },
  colors: {
    type: [
      {
        type: String,
        enum: ['W', 'U', 'B', 'R', 'G', 'C', ''],
      },
    ],
    default: null,
  },
  cmc: {
    type: Number,
    min: 0,
    default: null,
  },
  cardID: String,
  type_line: String,
  rarity: {
    type: String,
    default: null,
  },
  addedTmsp: Date,
  imgUrl: String,
  notes: String,
  colorCategory: {
    type: String,
    enum: [null, 'White', 'Blue', 'Black', 'Red', 'Green', 'Hybrid', 'Multicolored', 'Colorless', 'Lands'],
    default: null,
  },
};

// Cube schema
const cubeSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  shortID: {
    type: String,
    required: true,
  },
  urlAlias: String,
  owner: {
    type: String,
    required: true,
  },
  isListed: {
    type: Boolean,
    default: true,
  },
  privatePrices: {
    type: Boolean,
    default: false,
  },
  isFeatured: {
    type: Boolean,
    default: false,
  },
  overrideCategory: {
    type: Boolean,
    default: false,
  },
  categoryOverride: {
    type: String,
    default: 'Vintage',
  },
  categoryPrefixes: {
    type: [String],
    default: [],
  },
  tags: {
    type: [String],
    default: [],
  },
  cards: {
    type: [Card],
    default: [],
  },
  maybe: {
    type: [Card],
    default: [],
  },
  tag_colors: [
    {
      tag: String,
      color: String,
    },
  ],
  defaultDraftFormat: {
    type: Number,
    default: -1,
  },
  numDecks: {
    type: Number,
    default: 0,
  },
  description: String,
  descriptionhtml: String,
  image_uri: String,
  image_artist: String,
  image_name: String,
  owner_name: String,
  date_updated: Date,
  updated_string: String,
  default_sorts: [String],
  card_count: Number,
  type: String,
  draft_formats: {
    type: [
      {
        title: String,
        multiples: Boolean,
        html: String,
        packs: String,
      },
    ],
    default: [],
  },
  users_following: {
    type: [String],
    default: [],
  },
  defaultStatus: {
    type: String,
    default: 'Owned',
  },
  defaultPrinting: {
    type: String,
    // Values: first, recent
    default: 'recent',
  },
});

cubeSchema.index({
  shortID: 1,
});

cubeSchema.index({
  urlAlias: 1,
});

cubeSchema.index({
  owner: 1,
  date_updated: -1,
});

cubeSchema.index({
  name: 1,
  date_updated: -1,
});

// these indexes are for explore queries
cubeSchema.index({
  isFeatured: 1,
});

cubeSchema.index({
  isListed: 1,
  owner: 1,
  card_count: 1,
  date_updated: -1,
});

cubeSchema.index({
  isListed: 1,
  owner: 1,
  numDecks: -1,
});

const Cube = mongoose.model('Cube', cubeSchema);

Cube.LAYOUT_FIELDS = '_id owner name type card_count overrideCategory categoryOverride categoryPrefixes';
Cube.PREVIEW_FIELDS =
  '_id shortId urlAlias name card_count type overrideCategory categoryOverride categoryPrefixes image_name image_artist image_uri owner owner_name';

module.exports = Cube;
