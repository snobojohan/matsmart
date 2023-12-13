const { DateTime } = require("luxon");
const CleanCSS = require("clean-css");
const UglifyJS = require("uglify-js");
const htmlmin = require("html-minifier");
const eleventyNavigationPlugin = require("@11ty/eleventy-navigation");
const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const Image = require('@11ty/eleventy-img');

module.exports = function (eleventyConfig) {

  eleventyConfig.addShortcode("image", async function (src, alt) {
    if (alt === undefined) {
      // You bet we throw an error on missing alt (alt="" works okay)
      throw new Error(`Missing \`alt\` on myImage from: ${src}`);
    }

    let metadata = await Image(src, {
      widths: [600],
      formats: ["jpeg"]
    });

    let data = metadata.jpeg[metadata.jpeg.length - 1];
    return `<img src="${data.url}" width="${data.width}" height="${data.height}" alt="${alt}" loading="lazy" decoding="async">`;
  });

  // Eleventy Navigation https://www.11ty.dev/docs/plugins/navigation/
  eleventyConfig.addPlugin(eleventyNavigationPlugin);

  eleventyConfig.addNunjucksAsyncFilter("eleventyImage", async (src, options, callback) => {

    // Fix error with static images
    if (src.startsWith('/static')) {
      src = '.' + src
    }
    
    try {
      let metadata = await Image(src, options);
      callback(null, metadata);
    } catch (err) {
      callback(err);
    }
  });
  
  eleventyConfig.addNunjucksFilter("eleventyImageHtml", (metadata, options) => {
    return Image.generateHTML(metadata, options);
  });

  // Configuration API: use eleventyConfig.addLayoutAlias(from, to) to add
  // layout aliases! Say you have a bunch of existing content using
  // layout: post. If you don’t want to rewrite all of those values, just map
  // post to a new file like this:
  // eleventyConfig.addLayoutAlias("post", "layouts/my_new_post_layout.njk");

  // Merge data instead of overriding
  // https://www.11ty.dev/docs/data-deep-merge/
  eleventyConfig.setDataDeepMerge(true);

  // Add support for maintenance-free post authors
  // Adds an authors collection using the author key in our post frontmatter
  // Thanks to @pdehaan: https://github.com/pdehaan
  eleventyConfig.addCollection("authors", collection => {
    const blogs = collection.getFilteredByGlob("posts/*.md");
    return blogs.reduce((coll, post) => {
      const author = post.data.author;
      if (!author) {
        return coll;
      }
      if (!coll.hasOwnProperty(author)) {
        coll[author] = [];
      }
      coll[author].push(post.data);
      return coll;
    }, {});
  });

  // Date formatting (human readable)
  eleventyConfig.addFilter("readableDate", dateObj => {
    return DateTime.fromJSDate(dateObj).toFormat("dd LLL yyyy");
  });

  // Date formatting (machine readable)
  eleventyConfig.addFilter("machineDate", dateObj => {
    return DateTime.fromJSDate(dateObj).toFormat("yyyy-MM-dd");
  });

  // Minify CSS
  eleventyConfig.addFilter("cssmin", function (code) {
    return new CleanCSS({}).minify(code).styles;
  });

  // Minify JS
  eleventyConfig.addFilter("jsmin", function (code) {
    let minified = UglifyJS.minify(code);
    if (minified.error) {
      console.log("UglifyJS error: ", minified.error);
      return code;
    }
    return minified.code;
  });

  // Minify HTML output
  eleventyConfig.addTransform("htmlmin", function (content, outputPath) {
    if (outputPath.indexOf(".html") > -1) {
      let minified = htmlmin.minify(content, {
        useShortDoctype: true,
        removeComments: true,
        collapseWhitespace: true
      });
      return minified;
    }
    return content;
  });

  // Don't process folders with static assets e.g. images
  eleventyConfig.addPassthroughCopy("favicon.ico");
  eleventyConfig.addPassthroughCopy("static/img");
  eleventyConfig.addPassthroughCopy("admin");
  eleventyConfig.addPassthroughCopy("_includes/assets/css/inline.css");

  /* Markdown */

  let options = {
    html: true,
    breaks: true,
    linkify: true
  };
  let opts = {
    permalink: false
  };

  // Create and configure the Markdown-it instance
  let markdownLib = markdownIt(options).use(markdownItAnchor, opts);

  // TODO: Factor this out into another file
  // Modify the renderer rules within the configured instance
  // Thank you: https://tomichen.com/blog/posts/20220416-responsive-images-in-markdown-with-eleventy-image/
  markdownLib.renderer.rules.image = function (tokens, idx, options, env, self) {
    function figure(html, caption) {
      return `<figure>${html}<figcaption>${caption}</figcaption></figure>`
    }
  
    const token = tokens[idx]
    let imgSrc = token.attrGet('src')
    const imgAlt = token.content
    const imgTitle = token.attrGet('title')
  
    const htmlOpts = { alt: imgAlt, loading: 'lazy', decoding: 'async' }
  
    if (imgSrc.startsWith('/assets')) {
      imgSrc = 'src' + imgSrc
    }

    // Fix error with static images
    if (imgSrc.startsWith('/static')) {
      imgSrc = '.' + imgSrc
    }
  
    const parsed = (imgTitle || '').match(
      /^(?<skip>@skip(?:\[(?<width>\d+)x(?<height>\d+)\])? ?)?(?:\?\[(?<sizes>.*?)\] ?)?(?<caption>.*)/
    ).groups
  
    if (parsed.skip || imgSrc.startsWith('http')) {
      const options = { ...htmlOpts }
      if (parsed.sizes) {
        options.sizes = parsed.sizes
      }
  
      const metadata = { jpeg: [{ url: imgSrc }] }
      if (parsed.width && parsed.height) {
        metadata.jpeg[0].width = parsed.width
        metadata.jpeg[0].height = parsed.height
      }
  
      const generated = Image.generateHTML(metadata, options)
  
      if (parsed.caption) {
        return figure(generated, parsed.caption)
      }
      return generated
    }

    // TODO: add avif when support is good enough
    // TODO: less sizes?
  
    const widths = [250, 316, 426, 460, 580, 768]
    const imgOpts = {
      widths: widths
        .concat(widths.map((w) => w * 2)) // generate 2x sizes
        .filter((v, i, s) => s.indexOf(v) === i), // dedupe
      formats: ['webp', 'jpeg'], // TODO: add avif when support is good enough
      urlPath: '/assets/img/',
      outputDir: './_site/assets/img/'
    }
  
    Image(imgSrc, imgOpts)
  
    const metadata = Image.statsSync(imgSrc, imgOpts)
  
    const generated = Image.generateHTML(metadata, {
      sizes: parsed.sizes || '(max-width: 768px) 100vw, 768px',
      ...htmlOpts
    })
  
    if (parsed.caption) {
      return figure(generated, parsed.caption)
    }
    return generated
  }

  // Set the Markdown-it instance for Eleventy
  eleventyConfig.setLibrary("md", markdownLib);

  return {
    templateFormats: ["md", "njk", "html", "liquid"],

    // If your site lives in a different subdirectory, change this.
    // Leading or trailing slashes are all normalized away, so don’t worry about it.
    // If you don’t have a subdirectory, use "" or "/" (they do the same thing)
    // This is only used for URLs (it does not affect your file structure)
    pathPrefix: "/",

    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk",
    dir: {
      input: ".",
      includes: "_includes",
      data: "_data",
      output: "_site"
    }
  };
};
