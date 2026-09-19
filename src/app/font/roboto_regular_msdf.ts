import layout_data from "./roboto_regular_msdf_layout.json";
import atlas_url from "./roboto_regular_msdf_atlas.png";
import { type Layout, type Font, decode_png_to_image_data } from "./msdf.ts";

const layout: Layout = layout_data;

export async function load_font(): Promise<Font> {
  const image_data = await decode_png_to_image_data(atlas_url);
  return {
    layout,
    image_data,
  }
}
