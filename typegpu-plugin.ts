import { plugin } from 'bun';
import { bunPlugin } from 'unplugin-typegpu';

plugin(bunPlugin({
  include: /\.m?[t]sx?$/,
}));
